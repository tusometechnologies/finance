-- TUSOME Finance: the platform becomes the book of payments.
-- Adds: payments ledger (company and personal money), simpler reimbursements with part-payments,
-- pre-approved envelopes, an alternate approver for the Director's own items, and the November tracker import.
-- Run once after 001-004: Supabase > SQL Editor > New query > paste > Run.

-- ---------- 1. alternate approver for the Director's own items (habari@) ----------
alter table public.members drop constraint roles_valid;
alter table public.members add constraint roles_valid
  check (roles <@ array['admin','director','alt_director','approver','custodian','staff','auditor']::text[]);
update public.members set roles = array_append(roles, 'alt_director')
  where email = 'habari@tusome.ac.tz' and not 'alt_director' = any(roles);

-- Is this person a Director?
create or replace function public.is_director(e text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from members where email = e and 'director' = any(roles))
$$;

-- ---------- 2. Founders wallet is Hamis's personal money ----------
update public.accounts set data = data || jsonb_build_object('name','Founders wallet (Hamis personal)','holder','Personal',
  'status','Personal account used for company payments','signatories','Hamis Juma',
  'notes','Hamis Juma''s personal funds used for company payments. Amounts paid from it are owed to Hamis.')
  where id = 'ACC-05';
update public.claims set claimant = 'hamis@tusome.ac.tz', claimant_name = 'Hamis Juma',
  notes = 'Recorded in the tracker against Amriyya; confirmed 2026-11-20 as Founders wallet money, owed to Hamis. Verify against the tracker before paying.'
  where id = 'OPEN-005';

-- ---------- 3. envelopes can be pre-approved ----------
alter table public.envelopes add column if not exists pre_approved boolean not null default false;
alter table public.envelopes add column if not exists approved_by text;
alter table public.envelopes add column if not exists approved_at timestamptz;
create or replace function public.envelope_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if current_email() is null then return new; end if;
  if new.pre_approved and (tg_op = 'INSERT' or not old.pre_approved) then
    new.approved_by := current_email(); new.approved_at := now();
  elsif not new.pre_approved then
    new.approved_by := null; new.approved_at := null;
  else
    new.approved_by := old.approved_by; new.approved_at := old.approved_at;
  end if;
  return new;
end $$;
create trigger envelope_guard before insert or update on public.envelopes for each row execute function public.envelope_guard();

create or replace function public.tzs_of(amount numeric, currency text, d date) returns numeric
language sql stable security definer set search_path = public as $$
  select case when currency = 'USD' then amount * fx_rate_on(d) else amount end
$$;
create or replace function public.request_tzs(r public.requests) returns numeric
language sql stable security definer set search_path = public as $$
  select tzs_of(r.amount, r.currency, coalesce(nullif(r.details->>'fxDate','')::date, r.date))
$$;

-- ---------- 4. payments ledger ----------
create sequence if not exists public.pay_seq;
create table public.payments (
  id text primary key default ('PAY-' || extract(year from now())::int || '-' || lpad(nextval('public.pay_seq')::text, 4, '0')),
  date date not null default current_date,
  description text not null,
  payee text,
  supplier_id text references public.suppliers(id),
  amount numeric not null check (amount > 0),
  currency text not null default 'TZS' check (currency in ('TZS','USD')),
  kind text not null default 'Expense' check (kind in ('Expense','Advance','Subscription','Bank charge','Other')),
  category text, project text,
  envelope_id text references public.envelopes(id),
  request_id text references public.requests(id),
  funding text not null check (funding in ('Company','Personal')),
  account_id text references public.accounts(id),
  payer text,                         -- who paid, when personal (email, or name key)
  receipt_link text,
  fiscal text not null default 'Not checked' check (fiscal in ('Not checked','Verified','Exception approved','None')),
  notes text,
  status text not null default 'Submitted' check (status in ('Submitted','Approved','Rejected')),
  approval_basis text, decided_by text, decided_at timestamptz, decision_comment text,
  recorded_by text, recorded_at timestamptz not null default now(),
  tracker_id text unique,
  imported boolean not null default false,
  opening boolean not null default false
);

-- Money committed against an envelope, excluding one request or payment (for recalculation).
create or replace function public.envelope_used(p_env text, p_ex_req text, p_ex_pay text) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce((select sum(request_tzs(r)) from requests r
           where r.details->>'envelopeId' = p_env and r.submitted and r.id is distinct from p_ex_req
             and not exists (select 1 from approvals a where a.request_id = r.id and a.rev = r.rev and a.decision = 'Rejected')), 0)
       + coalesce((select sum(tzs_of(p.amount, p.currency, p.date)) from payments p
           where p.envelope_id = p_env and p.request_id is null and p.status <> 'Rejected' and p.id is distinct from p_ex_pay), 0)
$$;
-- Does a pre-approved, active envelope still cover this amount?
create or replace function public.envelope_covers(p_env text, p_tzs numeric, p_ex_req text, p_ex_pay text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select e.pre_approved and e.status = 'Active' and p_tzs is not null
                     and tzs_of(e.amount, e.currency, current_date) - envelope_used(e.id, p_ex_req, p_ex_pay) >= p_tzs
                   from envelopes e where e.id = nullif(p_env,'')), false)
$$;

create or replace function public.payments_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare me text := current_email(); r requests; basis text;
begin
  if me is null or in_fn() then return new; end if;
  if tg_op = 'UPDATE' then
    if old.status = 'Approved' then
      -- after approval only the evidence can change
      if (new.date, new.description, new.amount, new.currency, new.funding, new.account_id, new.payer, new.request_id, new.envelope_id, new.status)
         is distinct from (old.date, old.description, old.amount, old.currency, old.funding, old.account_id, old.payer, old.request_id, old.envelope_id, old.status) then
        raise exception 'An approved payment can only have its receipt, fiscal status, supplier or notes updated'; end if;
      new.id := old.id; new.recorded_by := old.recorded_by; new.imported := old.imported; new.opening := old.opening; new.tracker_id := old.tracker_id;
      new.approval_basis := old.approval_basis; new.decided_by := old.decided_by; new.decided_at := old.decided_at; new.decision_comment := old.decision_comment;
      return new;
    end if;
    new.id := old.id; new.recorded_by := old.recorded_by; new.imported := old.imported; new.opening := old.opening; new.tracker_id := old.tracker_id;
  else
    new.id := 'PAY-' || extract(year from now())::int || '-' || lpad(nextval('pay_seq')::text, 4, '0');
    new.recorded_by := me; new.recorded_at := now(); new.imported := false; new.opening := false; new.tracker_id := null;
  end if;
  if coalesce(btrim(new.receipt_link),'') = '' then raise exception 'Add a link to the receipt or proof of payment'; end if;
  if new.funding = 'Personal' then
    new.payer := coalesce(nullif(new.payer,''), me);
    if new.payer <> me and not has_any_role(array['custodian','admin']) then
      raise exception 'You can only record money you paid yourself'; end if;
  else
    new.payer := null;
    if new.account_id is null then raise exception 'Choose the company account the money came from'; end if;
  end if;
  -- approval: an approved purchase request or a pre-approved envelope covers it; otherwise it waits for a decision
  basis := null;
  if new.request_id is not null then
    select * into r from requests where id = new.request_id;
    if not chain_complete(r) then raise exception 'That purchase request is not fully approved yet'; end if;
    basis := 'Purchase request ' || r.id;
  elsif envelope_covers(new.envelope_id, tzs_of(new.amount, new.currency, new.date), null, new.id) then
    basis := 'Pre-approved envelope ' || new.envelope_id;
  end if;
  new.status := case when basis is null then 'Submitted' else 'Approved' end;
  new.approval_basis := basis; new.decided_by := case when basis is null then null else 'automatic' end;
  new.decided_at := case when basis is null then null else now() end; new.decision_comment := null;
  return new;
end $$;
create trigger payments_guard before insert or update on public.payments for each row execute function public.payments_guard();

-- Approve or reject a payment that no request or envelope covers.
-- Up to the USD threshold: a Band 1-2 approver, the Director or the alternate. Above it: the Director;
-- for the Director's own payments: the alternate (habari@). Nobody decides money they paid or recorded.
create or replace function public.decide_payment(p_id text, p_decision text, p_comment text default '')
returns void language plpgsql security definer set search_path = public as $$
declare p payments; me text := current_email(); usd numeric; thr numeric; own_dir boolean;
begin
  select * into p from payments where id = p_id for update;
  if not found then raise exception 'Payment not found'; end if;
  if p.status <> 'Submitted' then raise exception 'Only payments awaiting approval can be decided'; end if;
  if me in (p.payer, p.recorded_by) then raise exception 'You cannot approve a payment you made or recorded'; end if;
  if p_decision not in ('Approved','Rejected') then raise exception 'Invalid decision'; end if;
  if p_decision = 'Rejected' and coalesce(btrim(p_comment),'') = '' then raise exception 'Give a reason for rejection'; end if;
  select threshold_usd into thr from settings where id = 1;
  usd := usd_of(p.amount, p.currency, p.date);
  own_dir := is_director(p.payer) or is_director(p.recorded_by);
  if usd is not null and usd > thr then
    if own_dir then
      if not (has_role('alt_director') or has_role('director')) then raise exception 'The Director''s own payments above USD % need the alternate approver', thr; end if;
    elsif not has_role('director') then raise exception 'Payments above USD % need the Director', thr; end if;
  elsif not has_any_role(array['approver','director','alt_director']) then
    raise exception 'Only a Band 1-2 approver or the Director can decide payments';
  end if;
  perform set_config('tusome.fn', '1', true);
  update payments set status = p_decision, decided_by = me, decided_at = now(), decision_comment = coalesce(p_comment,''),
    approval_basis = 'Decision by ' || me where id = p_id;
  perform set_config('tusome.fn', '', true);
end $$;

-- ---------- 5. who we owe: balance = approved personal payments - reimbursements ----------
alter table public.reimbursements alter column tracker_id drop not null;
alter table public.reimbursements alter column claim_ids set default '{}';
alter table public.reimbursements add column if not exists reference text;

create or replace function public.owed_to(p_person text, p_currency text) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce((select sum(amount) from payments where funding = 'Personal' and payer = p_person and currency = p_currency
                   and status = 'Approved' and not imported), 0)
       - coalesce((select sum(amount) from reimbursements where claimant = p_person and currency = p_currency), 0)
$$;

-- Pay someone back, in full or in part. Finance custodian or admin; never yourself.
create or replace function public.record_repayment(p_person text, p_amount numeric, p_currency text, p_date date, p_account text, p_reference text)
returns text language plpgsql security definer set search_path = public as $$
declare me text := current_email(); owed numeric; rid text;
begin
  if not has_any_role(array['custodian','admin']) then raise exception 'Only the Finance custodian or an administrator can record reimbursements'; end if;
  if p_person = me then raise exception 'You cannot reimburse yourself; another custodian or administrator must record it'; end if;
  if coalesce(p_amount,0) <= 0 then raise exception 'Enter the amount paid back'; end if;
  owed := owed_to(p_person, p_currency);
  if p_amount > owed + 0.005 then raise exception 'That is more than TUSOME owes (% %)', p_currency, round(owed, 2); end if;
  rid := 'REI-' || extract(year from now())::int || '-' || lpad(nextval('reimb_seq')::text, 3, '0');
  insert into reimbursements(id, claimant, date, amount, currency, account_id, tracker_id, claim_ids, reference, recorded_by)
  values (rid, p_person, coalesce(p_date, current_date), p_amount, p_currency, nullif(p_account,''), null, '{}', nullif(btrim(p_reference),''), me);
  return rid;
end $$;

-- ---------- 6. requests: envelope pre-approval and the alternate approver ----------
create or replace function public.chain_complete(r public.requests) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((r.details->>'envelopeCovered')::boolean, false)
      or (select count(*) from approvals a where a.request_id = r.id and a.rev = r.rev and a.decision = 'Approved'
          and a.step = any(case when request_band(r) = 3 then array['ID','DIR'] else array['ID'] end))
       = (case when request_band(r) = 3 then 2 else 1 end)
$$;

create or replace function public.decide(p_request text, p_decision text, p_comment text default '')
returns void language plpgsql security definer set search_path = public as $$
declare r requests; me text := current_email(); b int; nxt text;
begin
  select * into r from requests where id = p_request for update;
  if not found then raise exception 'Request not found'; end if;
  if not r.submitted then raise exception 'This request has not been submitted'; end if;
  if chain_complete(r) then raise exception 'This request needs no further approval'; end if;
  if r.requester_email = me then raise exception 'You cannot approve your own request'; end if;
  if exists (select 1 from approvals where request_id = r.id and rev = r.rev and decision = 'Rejected') then
    raise exception 'This request was rejected; it must be revised first'; end if;
  b := request_band(r);
  if not exists (select 1 from approvals where request_id = r.id and rev = r.rev and step = 'ID' and decision = 'Approved') then nxt := 'ID';
  elsif b = 3 and not exists (select 1 from approvals where request_id = r.id and rev = r.rev and step = 'DIR' and decision = 'Approved') then nxt := 'DIR';
  else raise exception 'The approval chain is already complete'; end if;
  if nxt = 'ID' and not has_role('approver') then raise exception 'Only a Band 1-2 approver can make this decision'; end if;
  if nxt = 'DIR' and not (has_role('director') or (has_role('alt_director') and is_director(r.requester_email))) then
    raise exception 'Only the Director can make this decision (or the alternate, for the Director''s own requests)'; end if;
  if p_decision not in ('Approved','Rejected') then raise exception 'Invalid decision'; end if;
  if p_decision = 'Rejected' and coalesce(btrim(p_comment),'') = '' then raise exception 'Give a reason for rejection'; end if;
  insert into approvals(request_id, rev, step, decision, comment, by_email, amount, currency, band)
  values (r.id, r.rev, nxt, p_decision, coalesce(p_comment,''), me, r.amount, r.currency, b);
end $$;
create or replace function public.requests_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare me text := current_email(); b int; nq int;
begin
  if tg_op = 'INSERT' then
    if me is not null then           -- created through the app (SQL editor seeding has no user)
      new.requester_email := me; new.submitted := false; new.rev := 1; new.retro := false;
      new.details := (new.details - 'envelopeCovered');
      new.id := 'PRQ-' || extract(year from now())::int || '-' || lpad(nextval('prq_seq')::text, 3, '0');
    end if;
    return new;
  end if;
  if me is null then return new; end if;
  new.requester_email := old.requester_email; new.retro := old.retro; new.id := old.id;
  -- envelopeCovered is set only by the database
  new.details := (new.details - 'envelopeCovered') || jsonb_build_object('envelopeCovered', coalesce((old.details->>'envelopeCovered')::boolean, false));
  -- submitting
  if new.submitted and not old.submitted then
    if new.rev <> old.rev then raise exception 'Invalid revision'; end if;
    if new.supplier_id is null then raise exception 'Choose a supplier before submitting'; end if;
    b := request_band(new);
    nq := coalesce(jsonb_array_length(new.details->'quotes'), 0);
    if new.date >= (select policy_date from settings where id = 1)
       and nq < b and coalesce(new.details->>'waiver','') = '' then
      raise exception 'Band % needs % quotation(s) or an approved waiver reason', b, b; end if;
    new.submitted_at := now();
    new.details := new.details || jsonb_build_object('envelopeCovered', envelope_covers(new.details->>'envelopeId', request_tzs(new), new.id, null));
  end if;
  -- recalling to draft starts a new revision; earlier approvals stop counting
  if old.submitted and not new.submitted then
    if old.details ? 'payment' then raise exception 'A paid request cannot be recalled'; end if;
    new.rev := old.rev + 1;
    new.details := new.details || '{"envelopeCovered": false}'::jsonb;
  elsif new.rev <> old.rev then raise exception 'Revision numbers are set by the system';
  end if;
  -- once submitted, the commercial terms are locked
  if old.submitted and new.submitted and (new.amount <> old.amount or new.currency <> old.currency
      or new.supplier_id is distinct from old.supplier_id or new.date <> old.date
      or (new.details->>'fxDate') is distinct from (old.details->>'fxDate')
      or (new.details->'quotes') is distinct from (old.details->'quotes')) then
    raise exception 'Recall the request to draft before changing amount, supplier, date or quotations'; end if;
  -- delivery, invoice and payment only after full approval
  if not old.retro and not chain_complete(new) and (
       (new.details ? 'delivery' and not old.details ? 'delivery') or
       (new.details ? 'invoice'  and not old.details ? 'invoice') or
       (new.details ? 'payment'  and not old.details ? 'payment')) then
    raise exception 'Delivery, invoice and payment can only be recorded after full approval'; end if;
  if old.details ? 'payment' and not new.details ? 'payment' then
    raise exception 'A recorded payment cannot be removed; record a correction instead'; end if;
  if (old.details->'payment'->>'amount') is distinct from (new.details->'payment'->>'amount') and old.details ? 'payment' then
    raise exception 'A recorded payment amount cannot be changed'; end if;
  if new.details ? 'payment' and coalesce(new.details->'payment'->>'trackerId','') = '' then
    raise exception 'A payment needs the expenditure tracker Record ID'; end if;
  return new;
end $$;
-- ---------- 7. security, audit, live updates ----------
create trigger audit_payments after insert or update or delete on public.payments for each row execute function public.audit_row();
alter table public.payments enable row level security;
create policy read_payments on public.payments for select to authenticated
  using (is_member() and (funding = 'Company' or payer = current_email() or recorded_by = current_email() or sees_all_claims()));
create policy ins_payments on public.payments for insert to authenticated with check (can_write());
create policy upd_payments on public.payments for update to authenticated
  using (recorded_by = current_email() or has_any_role(array['admin','custodian'])) with check (can_write());
create policy del_payments on public.payments for delete to authenticated
  using ((recorded_by = current_email() and status <> 'Approved') or (has_role('admin') and not imported));
grant select, insert, update, delete on public.payments to authenticated;
revoke all on public.payments from anon;
grant usage, select on all sequences in schema public to authenticated;
revoke execute on function public.decide_payment(text,text,text), public.record_repayment(text,numeric,text,date,text,text) from public, anon;
grant execute on function public.decide_payment(text,text,text), public.record_repayment(text,numeric,text,date,text,text),
  public.owed_to(text,text), public.is_director(text), public.tzs_of(numeric,text,date), public.request_tzs(public.requests),
  public.envelope_used(text,text,text), public.envelope_covers(text,numeric,text,text) to authenticated;
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.payments;
  end if; end $$;

-- ---------- 8. move expense claims into the ledger (claims become history) ----------
insert into public.payments (id, date, description, payee, amount, currency, category, project, envelope_id, funding, payer,
  receipt_link, notes, status, approval_basis, decided_by, decided_at, decision_comment, recorded_by, recorded_at, opening)
select c.id, c.date, c.description, c.payee, c.amount, c.currency, c.category, c.project, c.envelope_id, 'Personal', c.claimant,
  coalesce(c.receipt_link, case when c.opening then 'opening balance' end), c.notes,
  case c.status when 'Reimbursed' then 'Approved' when 'Draft' then 'Submitted' else c.status end,
  case when c.opening then 'Opening balance from the expenditure tracker' when c.status in ('Approved','Reimbursed') then 'Decision by ' || c.decided_by end,
  c.decided_by, c.decided_at, c.decision_comment, coalesce(c.claimant, 'system'), c.created_at, c.opening
from public.claims c
on conflict (id) do nothing;

-- ---------- 9. November 2026 payments from the expenditure tracker (prototype snapshot) ----------
-- Personal payments imported here do not add to "who we owe": the opening balances already carry that.
insert into public.payments (tracker_id, date, description, payee, amount, currency, kind, category, project, funding, account_id, payer, receipt_link, status, approval_basis, decided_by, notes)
values
  ('Q426-070','2026-11-01','Business fuel and transport','Lake Oil Limited, Darajani Service Station',27060.0,'TZS','Expense','Operations & Essential Costs','TUSOME operations','Personal','ACC-06','hamis@tusome.ac.tz',null,'Approved','Approved in the expenditure tracker by Hamis Juma','Hamis Juma','Imported from the expenditure tracker (prototype snapshot, Nov 2026). Account in tracker: Hamis Selcom Pesa. Paid by: Hamis Juma. Evidence: #gid=1747579123&range=A39'),
  ('Q426-071','2026-11-01','Workshop retrospective and team learning','Yasma Food and Beverages Company Ltd',53000.0,'TZS','Expense','Training','TUSOME workshop retrospective, November 2026','Personal','ACC-06','hamis@tusome.ac.tz',null,'Approved','Approved in the expenditure tracker by Hamis Juma','Hamis Juma','Imported from the expenditure tracker (prototype snapshot, Nov 2026). Account in tracker: Hamis Selcom Pesa. Paid by: Hamis Juma. Evidence: #gid=1747579123&range=A41'),
  ('Q426-072','2026-11-02','AI RCT endline printing and preparation','SAI Office',448400.0,'TZS','Expense','M&E, Reporting, and Legal Support','AI RCT endline printing — Zanzibar','Personal','ACC-07','joseph@tusome.ac.tz','https://drive.google.com/file/d/1s9eZ8V1_SQtzcUZE0mCwEyIeCW16OtJg/view?usp=drivesdk','Approved','Approved in the expenditure tracker by Hamis Juma','Hamis Juma','Imported from the expenditure tracker (prototype snapshot, Nov 2026). Account in tracker: Joseph Selcom Pesa. Paid by: Joseph Vicent. Evidence: 2026-11-02_Selcom-1102YKH05_Joseph_SAI-Office_Magenta-Printer-Ink_TZS448400_Charges-TZS1250.jpeg'),
  ('Q426-073','2026-11-02','AI RCT endline printing and preparation','Selcom / Mixx by Yas',1250.0,'TZS','Expense','M&E, Reporting, and Legal Support','AI RCT endline printing — Zanzibar','Personal','ACC-07','joseph@tusome.ac.tz','https://drive.google.com/file/d/1s9eZ8V1_SQtzcUZE0mCwEyIeCW16OtJg/view?usp=drivesdk','Approved','Approved in the expenditure tracker by Hamis Juma','Hamis Juma','Imported from the expenditure tracker (prototype snapshot, Nov 2026). Account in tracker: Joseph Selcom Pesa. Paid by: Joseph Vicent. Evidence: 2026-11-02_Selcom-1102YKH05_Joseph_SAI-Office_Magenta-Printer-Ink_TZS448400_Charges-TZS1250.jpeg'),
  ('Q426-074','2026-11-02','AI RCT endline printing and preparation','Patrick Ngahatilwa',100000.0,'TZS','Expense','M&E, Reporting, and Legal Support','AI RCT endline printing — Zanzibar','Personal','ACC-07','joseph@tusome.ac.tz','https://drive.google.com/file/d/1dhLBDIVJxMvp4RxghFusXa5L65LKl7EP/view?usp=drivesdk','Approved','Approved in the expenditure tracker by Hamis Juma','Hamis Juma','Imported from the expenditure tracker (prototype snapshot, Nov 2026). Account in tracker: Joseph Selcom Pesa. Paid by: Joseph Vicent. Evidence: 2026-11-02_Selcom-1102YPN7X_Joseph_Patrick_Printer-Service_AI-RCT-Zanzibar_TZS100000.jpeg'),
  ('Q426-075','2026-11-02','AI RCT endline printing and preparation','Judith Severini John',190000.0,'TZS','Expense','M&E, Reporting, and Legal Support','AI RCT endline printing — Zanzibar','Personal','ACC-07','joseph@tusome.ac.tz','https://drive.google.com/file/d/1vIgY9OAFBbe6GXqANNy3fz6SLvAdOqDd/view?usp=drivesdk','Approved','Approved in the expenditure tracker by Hamis Juma','Hamis Juma','Imported from the expenditure tracker (prototype snapshot, Nov 2026). Account in tracker: Joseph Selcom Pesa. Paid by: Joseph Vicent. Evidence: 2026-11-02_Selcom-1102YM4WW_Joseph_Judith_A4-Paper_AI-RCT-Zanzibar_TZS190000_Charges-TZS1000.jpeg'),
  ('Q426-076','2026-11-02','AI RCT endline printing and preparation','Selcom / CRDB transfer',1000.0,'TZS','Expense','M&E, Reporting, and Legal Support','AI RCT endline printing — Zanzibar','Personal','ACC-07','joseph@tusome.ac.tz','https://drive.google.com/file/d/1vIgY9OAFBbe6GXqANNy3fz6SLvAdOqDd/view?usp=drivesdk','Approved','Approved in the expenditure tracker by Hamis Juma','Hamis Juma','Imported from the expenditure tracker (prototype snapshot, Nov 2026). Account in tracker: Joseph Selcom Pesa. Paid by: Joseph Vicent. Evidence: 2026-11-02_Selcom-1102YM4WW_Joseph_Judith_A4-Paper_AI-RCT-Zanzibar_TZS190000_Charges-TZS1000.jpeg'),
  ('Q426-077','2026-11-02','AI RCT endline printing and preparation','PesaPal',149184,'TZS','Expense','M&E, Reporting, and Legal Support','AI RCT endline printing — Zanzibar','Company','ACC-02',null,'https://drive.google.com/file/d/1NXRkA9xw4LsbUjm4tplQBeqBIxdE7znb/view?usp=drivesdk','Approved','Approved in the expenditure tracker by Hamis Juma','Hamis Juma','Imported from the expenditure tracker (prototype snapshot, Nov 2026). Account in tracker: PesaPal. Paid by: TUSOME Technologies. Evidence: 2026-11-02_PesaPal_Dashboard_Michael-Muthukrishna_Received-TZS4144000.png'),
  ('Q426-078','2026-11-03','Design practice and product development learning','Perk / Kenya Airways',487.41,'USD','Advance','Training','TUSOME professional development — Design Academy Entebbe','Personal','ACC-08','hamis@tusome.ac.tz','https://drive.google.com/file/d/1_GRpQWTD_8dlvIi06Uel5skNz6t5NZMW/view?usp=drivesdk','Approved','Approved in the expenditure tracker by Hamis Juma','Hamis Juma','Imported from the expenditure tracker (prototype snapshot, Nov 2026). Account in tracker: Hamis credit card. Paid by: Hamis Juma. Evidence: 2026-11-25_to-28_Perk-52143096_Hamis_Design-Academy-Entebbe_Airfare-USD487.41_FlexiTravel-USD48.74.pdf'),
  ('Q426-079','2026-11-03','Design practice and product development learning','Perk FlexiTravel',48.74,'USD','Advance','Training','TUSOME professional development — Design Academy Entebbe','Personal','ACC-08','hamis@tusome.ac.tz','https://drive.google.com/file/d/1_GRpQWTD_8dlvIi06Uel5skNz6t5NZMW/view?usp=drivesdk','Approved','Approved in the expenditure tracker by Hamis Juma','Hamis Juma','Imported from the expenditure tracker (prototype snapshot, Nov 2026). Account in tracker: Hamis credit card. Paid by: Hamis Juma. Evidence: 2026-11-25_to-28_Perk-52143096_Hamis_Design-Academy-Entebbe_Airfare-USD487.41_FlexiTravel-USD48.74.pdf'),
  ('Q426-080','2026-11-02','AI RCT endline printing materials','Printer toner purchase — voucher 0013',385000.0,'TZS','Expense','M&E, Reporting, and Legal Support','AI RCT endline printing — Zanzibar','Personal','ACC-05','hamis@tusome.ac.tz','https://drive.google.com/file/d/18JpLDiG9RiF5hQfWJ4fKk7TTzQQduRP8/view?usp=drivesdk','Approved','Approved in the expenditure tracker by Hamis Juma','Hamis Juma','Imported from the expenditure tracker (prototype snapshot, Nov 2026). Account in tracker: Founders wallet — cash. Paid by: Hamis Juma. Evidence: 2026-11-02_to-04_PettyCash-0013-0010_Toner-TZS385000_Entebbe-Incidentals-TZS600000.pdf'),
  ('Q426-081','2026-11-04','Design Academy role learning in Entebbe','Entebbe meals and travel incidentals',600000.0,'TZS','Advance','Training','TUSOME professional development — Design Academy Entebbe','Personal','ACC-05','hamis@tusome.ac.tz','https://drive.google.com/file/d/18JpLDiG9RiF5hQfWJ4fKk7TTzQQduRP8/view?usp=drivesdk','Approved','Approved in the expenditure tracker by Hamis Juma','Hamis Juma','Imported from the expenditure tracker (prototype snapshot, Nov 2026). Account in tracker: Founders wallet — petty cash. Paid by: Hamis Juma. Evidence: 2026-11-02_to-04_PettyCash-0013-0010_Toner-TZS385000_Entebbe-Incidentals-TZS600000.pdf'),
  ('Q426-082','2026-11-04','AI RCT endline printing service','Patrick John Ngahatilwa',50000.0,'TZS','Expense','M&E, Reporting, and Legal Support','AI RCT endline printing — Zanzibar','Personal','ACC-07','joseph@tusome.ac.tz','https://drive.google.com/file/d/1WGK0Ueu-MFn8eTehYjlu9GYPLtU0Xa0v/view?usp=drivesdk','Approved','Approved in the expenditure tracker by Hamis Juma','Hamis Juma','Imported from the expenditure tracker (prototype snapshot, Nov 2026). Account in tracker: Joseph Selcom Pesa. Paid by: Joseph Vicent. Evidence: 2026-11-04_Selcom-1104YVJ43_Joseph_Patrick_AI-RCT-Printing-Service_TZS50000.jpeg'),
  ('Q426-083','2026-11-04','ElevenLabs voice tools for TUSOME','Eleven Labs Inc.',1.0,'USD','Subscription','Product Development & Tech Improvements','TUSOME digital tools','Personal','ACC-08','hamis@tusome.ac.tz',null,'Approved','Approved in the expenditure tracker by Hamis Juma','Hamis Juma','Imported from the expenditure tracker (prototype snapshot, Nov 2026). Account in tracker: Hamis Visa ending 7798. Paid by: Hamis Juma. Evidence: #gid=1747579123&range=A43'),
  ('Q426-091','2026-11-04','Office guest refreshments','Makjuice',9000.0,'TZS','Expense','Operations & Essential Costs','TUSOME operations','Personal','ACC-07','joseph@tusome.ac.tz','https://drive.google.com/file/d/1POR061g0tI_mFxdQtX1m2AGHmf5rEC55/view','Approved','Approved in the expenditure tracker by Hamis Juma','Hamis Juma','Imported from the expenditure tracker (prototype snapshot, Nov 2026). Account in tracker: Joseph Selcom Pesa. Paid by: Joseph Vicent. Evidence: 2026-11-04_Selcom-1104YXRBY_Joseph_Makjuice_Laptop-and-Accessories_TZS9000.jpeg'),
  ('Q426-092','2026-11-04','AI RCT endline printing and preparation','Joseph Vicent Kway',2250000.0,'TZS','Advance','M&E, Reporting, and Legal Support','AI RCT endline printing — Zanzibar','Company','ACC-02',null,'https://drive.google.com/file/d/1SCjKAfI9P2XUvsRLVDnrgjpPQjc5hp1f/view','Approved','Approved in the expenditure tracker by Hamis Juma','Hamis Juma','Imported from the expenditure tracker (prototype snapshot, Nov 2026). Account in tracker: Hamis Selcom (PesaPal-funded). Paid by: Joseph Vicent. Evidence: 2026-11-04_Selcom-1104YYDGD_Hamis-to-Joseph_PesaPal_AI-RCT-Printing-Advance_TZS2250000.jpeg'),
  ('Q426-093','2026-11-04','Electricity; premises to confirm','LUKU prepaid electricity',5000.0,'TZS','Expense','Operations & Essential Costs',null,'Personal','ACC-07','joseph@tusome.ac.tz','https://drive.google.com/file/d/1FURhyR2I32559zbRfsL6-_RNAGaygAw8/view?usp=drivesdk','Approved','Approved in the expenditure tracker by Hamis Juma','Hamis Juma','Imported from the expenditure tracker (prototype snapshot, Nov 2026). Account in tracker: Joseph Selcom Pesa. Paid by: Joseph Vicent Kway. Evidence: 2026-11-04_Selcom-1104YZG4Z_Joseph_LUKU-TZS5000_Charges-TZS60.jpeg'),
  ('Q426-094','2026-11-04','Electricity payment transaction charge','Selcom Pesa',60.0,'TZS','Expense','Operations & Essential Costs',null,'Personal','ACC-07','joseph@tusome.ac.tz','https://drive.google.com/file/d/1FURhyR2I32559zbRfsL6-_RNAGaygAw8/view?usp=drivesdk','Approved','Approved in the expenditure tracker by Hamis Juma','Hamis Juma','Imported from the expenditure tracker (prototype snapshot, Nov 2026). Account in tracker: Joseph Selcom Pesa. Paid by: Joseph Vicent Kway. Evidence: 2026-11-04_Selcom-1104YZG4Z_Joseph_LUKU-TZS5000_Charges-TZS60.jpeg'),
  ('Q426-095','2026-11-04','Paper delivery and logistics','Green Mtambo',23000.0,'TZS','Expense','Operations & Essential Costs',null,'Personal','ACC-07','joseph@tusome.ac.tz','https://drive.google.com/file/d/1aKMLXSXZE63iqy6vKwuTHAor_tTsA8PE/view?usp=drivesdk','Approved','Approved in the expenditure tracker by Hamis Juma','Hamis Juma','Imported from the expenditure tracker (prototype snapshot, Nov 2026). Account in tracker: Joseph Selcom Pesa. Paid by: Joseph Vicent Kway. Evidence: 2026-11-04_Selcom-1104YZKK1_Joseph_Green-Mtambo_Paper-Transport_TZS23000.jpeg'),
  ('Q426-098','2026-11-06','Office operations and printing support','LUKU electricity',5000.0,'TZS','Expense','Operations & Essential Costs','TUSOME operations / AI RCT printing','Personal','ACC-05','hamis@tusome.ac.tz','https://drive.google.com/file/d/10z8vw0A0-ZBmFP54_4L9Zy0jgg0ja5Tq/view','Approved','Approved in the expenditure tracker by Hamis Juma','Hamis Juma','Imported from the expenditure tracker (prototype snapshot, Nov 2026). Account in tracker: Founders wallet — payment account to reconcile. Paid by: Joseph Vicent / founder wallet. Evidence: WhatsApp Image 2026-11-06 at 20.37.23.jpeg'),
  ('Q426-099','2026-11-05','Office operations and printing support','Judith Severini John',335000.0,'TZS','Expense','M&E, Reporting, and Legal Support','TUSOME operations / AI RCT printing','Personal','ACC-05','hamis@tusome.ac.tz','https://drive.google.com/file/d/1BhqUjNzvi9nRaBXjSacQXjL2QwmhtBfP/view','Approved','Approved in the expenditure tracker by Hamis Juma','Hamis Juma','Imported from the expenditure tracker (prototype snapshot, Nov 2026). Account in tracker: Founders wallet — payment account to reconcile. Paid by: Joseph Vicent / founder wallet. Evidence: WhatsApp Image 2026-11-06 at 20.38.40.jpeg'),
  ('Q426-100','2026-11-05','Office operations and printing support','Home City 2',20800.0,'TZS','Expense','M&E, Reporting, and Legal Support','TUSOME operations / AI RCT printing','Personal','ACC-05','hamis@tusome.ac.tz','https://drive.google.com/file/d/1eCGVDYxvUQna5svTgyc_Yn4xXv99THzv/view','Approved','Approved in the expenditure tracker by Hamis Juma','Hamis Juma','Imported from the expenditure tracker (prototype snapshot, Nov 2026). Account in tracker: Founders wallet — payment account to reconcile. Paid by: Joseph Vicent / founder wallet. Evidence: WhatsApp Image 2026-11-06 at 20.40.52.jpeg'),
  ('Q426-101','2026-11-05','Office operations and printing support','Fredy Jemsi Shabani',6500.0,'TZS','Expense','Operations & Essential Costs','TUSOME operations / AI RCT printing','Personal','ACC-05','hamis@tusome.ac.tz','https://drive.google.com/file/d/1FvjZVsx-SjT3pNQOcyMCT36uZz8V_WNx/view','Approved','Approved in the expenditure tracker by Hamis Juma','Hamis Juma','Imported from the expenditure tracker (prototype snapshot, Nov 2026). Account in tracker: Founders wallet — payment account to reconcile. Paid by: Joseph Vicent / founder wallet. Evidence: WhatsApp Image 2026-11-06 at 20.45.52.jpeg'),
  ('Q426-102','2026-11-07','Office operations and printing support','LUKU electricity',5000.0,'TZS','Expense','Operations & Essential Costs','TUSOME operations / AI RCT printing','Personal','ACC-05','hamis@tusome.ac.tz','https://drive.google.com/file/d/1cireT40CHQUqjl8cF9QuHk4iWs5CqE-Z/view','Approved','Approved in the expenditure tracker by Hamis Juma','Hamis Juma','Imported from the expenditure tracker (prototype snapshot, Nov 2026). Account in tracker: Founders wallet — payment account to reconcile. Paid by: Joseph Vicent / founder wallet. Evidence: WhatsApp Image 2026-11-07 at 07.34.33.jpeg'),
  ('Q426-103','2026-11-07','Office operations and printing support','Selcom',60.0,'TZS','Expense','Operations & Essential Costs','TUSOME operations / AI RCT printing','Personal','ACC-05','hamis@tusome.ac.tz','https://drive.google.com/file/d/1cireT40CHQUqjl8cF9QuHk4iWs5CqE-Z/view','Approved','Approved in the expenditure tracker by Hamis Juma','Hamis Juma','Imported from the expenditure tracker (prototype snapshot, Nov 2026). Account in tracker: Founders wallet — payment account to reconcile. Paid by: Joseph Vicent / founder wallet. Evidence: WhatsApp Image 2026-11-07 at 07.34.33.jpeg'),
  ('Q426-104','2026-11-07','Office operations and printing support','Manjia Stationery',202000.0,'TZS','Expense','Operations & Essential Costs','TUSOME operations / AI RCT printing','Personal','ACC-05','hamis@tusome.ac.tz','https://drive.google.com/file/d/10uhEy1EUedsZOTEx2yZsSjPzePAiOBee/view','Approved','Approved in the expenditure tracker by Hamis Juma','Hamis Juma','Imported from the expenditure tracker (prototype snapshot, Nov 2026). Account in tracker: Founders wallet — payment account to reconcile. Paid by: Joseph Vicent / founder wallet. Evidence: WhatsApp Image 2026-11-07 at 09.59.53.jpeg'),
  ('Q426-105','2026-11-07','Office operations and printing support','Selcom / M-Pesa',1100.0,'TZS','Expense','Operations & Essential Costs','TUSOME operations / AI RCT printing','Personal','ACC-05','hamis@tusome.ac.tz','https://drive.google.com/file/d/10uhEy1EUedsZOTEx2yZsSjPzePAiOBee/view','Approved','Approved in the expenditure tracker by Hamis Juma','Hamis Juma','Imported from the expenditure tracker (prototype snapshot, Nov 2026). Account in tracker: Founders wallet — payment account to reconcile. Paid by: Joseph Vicent / founder wallet. Evidence: WhatsApp Image 2026-11-07 at 09.59.53.jpeg'),
  ('Q426-106','2026-11-06','Office operations and printing support','Lake Oil Limited',20088.0,'TZS','Expense','Operations & Essential Costs','TUSOME operations / AI RCT printing','Personal','ACC-05','hamis@tusome.ac.tz','https://drive.google.com/file/d/1qsp0peAyLhB73sxepFdvs_uRD-qqza5o/view','Approved','Approved in the expenditure tracker by Hamis Juma','Hamis Juma','Imported from the expenditure tracker (prototype snapshot, Nov 2026). Account in tracker: Founders wallet — payment account to reconcile. Paid by: Hamis Juma. Evidence: WhatsApp Image 2026-11-06 at 19.52.55.jpeg'),
  ('Q426-107','2026-11-06','Office operations and printing support','Judith Severini John',335000.0,'TZS','Expense','M&E, Reporting, and Legal Support','TUSOME operations / AI RCT printing','Personal','ACC-05','hamis@tusome.ac.tz','https://drive.google.com/file/d/1L3zLV1MNYU7kgVIm_E6qjzUMlnejCpe_/view','Approved','Approved in the expenditure tracker by Hamis Juma','Hamis Juma','Imported from the expenditure tracker (prototype snapshot, Nov 2026). Account in tracker: Founders wallet — payment account to reconcile. Paid by: Joseph Vicent / founder wallet. Evidence: WhatsApp Image 2026-11-06 at 20.44.12.jpeg'),
  ('Q426-108','2026-11-06','AI RCT endline printing labour','Joseph Vicent Kway',600000.0,'TZS','Advance','M&E, Reporting, and Legal Support','AI RCT endline printing — Zanzibar','Company','ACC-02',null,'https://drive.google.com/file/d/1Zkv5NPpsRjoSy5EIZQNOpYc8ge1KoAsZ/view','Approved','Approved in the expenditure tracker by Hamis Juma','Hamis Juma','Imported from the expenditure tracker (prototype snapshot, Nov 2026). Account in tracker: Hamis Selcom — PesaPal funded. Paid by: Hamis Juma. Evidence: WhatsApp Image 2026-11-06 at 21.11.20.jpeg'),
  ('Q426-109','2026-11-06','Team fuel and office transport, 1–15 Nov','Joseph Vicent Kway',200000.0,'TZS','Advance','Operations & Essential Costs','TUSOME operations','Company','ACC-02',null,'https://drive.google.com/file/d/1Zkv5NPpsRjoSy5EIZQNOpYc8ge1KoAsZ/view','Approved','Approved in the expenditure tracker by Hamis Juma','Hamis Juma','Imported from the expenditure tracker (prototype snapshot, Nov 2026). Account in tracker: Hamis Selcom — PesaPal funded. Paid by: Hamis Juma. Evidence: WhatsApp Image 2026-11-06 at 21.11.20.jpeg'),
  ('Q426-110','2026-11-10','AI RCT endline survey','PesaPal',17772.48,'TZS','Expense','M&E, Reporting, and Legal Support','AI RCT Zanzibar endline','Company','ACC-02',null,'https://drive.google.com/file/d/1DDpnt3ZQ7ES-gM6ZK_kycpGO_emevycu/view','Approved','Approved in the expenditure tracker',null,'Imported from the expenditure tracker (prototype snapshot, Nov 2026). Account in tracker: PesaPal. Paid by: TUSOME Technologies. Evidence: 2026-11-10_PesaPal_Three_Receipts_AI_RCT.jpg'),
  ('Q426-111','2026-11-10','AI RCT endline survey','PesaPal',8578.08,'TZS','Expense','M&E, Reporting, and Legal Support','AI RCT Zanzibar endline','Company','ACC-02',null,'https://drive.google.com/file/d/1DDpnt3ZQ7ES-gM6ZK_kycpGO_emevycu/view','Approved','Approved in the expenditure tracker',null,'Imported from the expenditure tracker (prototype snapshot, Nov 2026). Account in tracker: PesaPal. Paid by: TUSOME Technologies. Evidence: 2026-11-10_PesaPal_Three_Receipts_AI_RCT.jpg'),
  ('Q426-112','2026-11-10','AI RCT endline survey','PesaPal',41601.6,'TZS','Expense','M&E, Reporting, and Legal Support','AI RCT Zanzibar endline','Company','ACC-02',null,'https://drive.google.com/file/d/1DDpnt3ZQ7ES-gM6ZK_kycpGO_emevycu/view','Approved','Approved in the expenditure tracker',null,'Imported from the expenditure tracker (prototype snapshot, Nov 2026). Account in tracker: PesaPal. Paid by: TUSOME Technologies. Evidence: 2026-11-10_PesaPal_Three_Receipts_AI_RCT.jpg'),
  ('Q426-113','2026-11-12','Transport and accommodation for two days in Zanzibar to conduct tests.','Joseph Vicent Kway',700000.0,'TZS','Expense','M&E, Reporting, and Legal Support','Zanzibar testing','Personal','ACC-06','hamis@tusome.ac.tz','https://drive.google.com/file/d/1RndiSaVwG8HASJCqmRyr7f-jAYkkTTq7/view','Approved','Approved in the expenditure tracker by Hamis Juma','Hamis Juma','Imported from the expenditure tracker (prototype snapshot, Nov 2026). Account in tracker: Hamis Selcom Pesa. Paid by: Hamis Juma. Evidence: 1112104TD1 receipt'),
  ('Q426-114','2026-11-11','Field travel support for Ibrahim.','Ibrahimu Hamisi',20000.0,'TZS','Expense','Operations & Essential Costs','TUSOME operations','Personal','ACC-06','hamis@tusome.ac.tz','https://drive.google.com/file/d/1hryCQPFplOIRxIQFgCZO0Nb13XniznbQ/view','Approved','Approved in the expenditure tracker by Hamis Juma','Hamis Juma','Imported from the expenditure tracker (prototype snapshot, Nov 2026). Account in tracker: Hamis Selcom Pesa. Paid by: Hamis Juma. Evidence: 1111ZY5KH receipt'),
  ('Q426-115','2026-11-08','Office essentials; item details not shown on payment receipt.','Home Market Supermarket HQ',25000.0,'TZS','Expense','Operations & Essential Costs','TUSOME operations','Personal','ACC-06','hamis@tusome.ac.tz','https://drive.google.com/file/d/1VWx8nPiS0zjrMJBTFcjX0-g0EoFiAQnM/view','Approved','Approved in the expenditure tracker by Hamis Juma','Hamis Juma','Imported from the expenditure tracker (prototype snapshot, Nov 2026). Account in tracker: Hamis Selcom Pesa. Paid by: Hamis Juma. Evidence: 1108ZKA01 receipt'),
  ('Q426-116','2026-11-13','TIE resource validation and compliance','Amriyya Omary',100000.0,'TZS','Expense','Safeguarding, Gender, & Compliance','TUSOME resource validation','Personal','ACC-06','hamis@tusome.ac.tz','https://drive.google.com/file/d/1AOkdfK6oCzie92r7bDJFvKV_L5k9zjug/view','Approved','Approved in the expenditure tracker by Hamis Juma','Hamis Juma','Imported from the expenditure tracker (prototype snapshot, Nov 2026). Account in tracker: Hamis Selcom Pesa. Paid by: Hamis Juma. Evidence: 2026-11-14_Selcom_111410EP79_Amriyya_TIE_Validation_TZS100000.jpeg'),
  ('Q426-117','2026-11-09','Morogoro TIE resource validation and compliance','Tanzania Railways Corporation',13500.0,'TZS','Expense','Safeguarding, Gender, & Compliance','TUSOME TIE activities','Personal',null,'hamis@tusome.ac.tz','https://drive.google.com/file/d/1HicRt8vVn7Pd8RMPgGbgiEZ45_9LasnA/view','Approved','Approved in the expenditure tracker by Hamis Juma','Hamis Juma','Imported from the expenditure tracker (prototype snapshot, Nov 2026). Account in tracker: not recorded. Paid by: Hamis Juma. Evidence: 2026-11-13_TRC_Dar_Morogoro_Hamis_TZS13500.pdf'),
  ('Q426-118','2026-11-09','Morogoro TIE resource validation and compliance','Tanzania Railways Corporation',22500.0,'TZS','Expense','Safeguarding, Gender, & Compliance','TUSOME TIE activities','Company',null,null,'https://drive.google.com/file/d/1JkTDwLPGJqtb8DUuuSnrSyYHtfsuxsGl/view','Approved','Approved in the expenditure tracker by Hamis Juma','Hamis Juma','Imported from the expenditure tracker (prototype snapshot, Nov 2026). Account in tracker: not recorded. Paid by: Hamis Juma. Evidence: 2026-11-16_TRC_Morogoro_Dar_Hamis_TZS22500.pdf'),
  ('Q426-119','2026-11-14','Morogoro TIE activity travel meal','Sunset Terrace / Forest Sunset Hotel',23000.0,'TZS','Expense','Safeguarding, Gender, & Compliance','TUSOME TIE activities','Personal','ACC-06','hamis@tusome.ac.tz','https://drive.google.com/file/d/15dOPxGDW7Lj51v4iqs83VegUGe4_kk0w/view','Approved','Approved in the expenditure tracker by Hamis Juma','Hamis Juma','Imported from the expenditure tracker (prototype snapshot, Nov 2026). Account in tracker: Hamis Selcom Pesa. Paid by: Hamis Juma. Evidence: Sunset Terrace bill and Selcom 111410FVH5'),
  ('Q426-120','2026-11-14','Morogoro TIE activity travel meal','Sunset Terrace',10000.0,'TZS','Expense','Safeguarding, Gender, & Compliance','TUSOME TIE activities','Personal','ACC-05','hamis@tusome.ac.tz','https://drive.google.com/file/d/185Jtdooa1IR6iSAecMgytWQ48zVsPwz-/view','Approved','Approved in the expenditure tracker by Hamis Juma','Hamis Juma','Imported from the expenditure tracker (prototype snapshot, Nov 2026). Account in tracker: Founders wallet — Cash. Paid by: Hamis Juma. Evidence: Sunset Terrace customer bill'),
  ('Q426-121','2026-11-15','Morogoro TIE activity travel meal','Sunset Terrace',20000.0,'TZS','Expense','Safeguarding, Gender, & Compliance','TUSOME TIE activities','Personal','ACC-05','hamis@tusome.ac.tz','https://drive.google.com/file/d/1jKRfqyKasz959JfqSz_v9tTLbj_uFvMK/view','Approved','Approved in the expenditure tracker by Hamis Juma','Hamis Juma','Imported from the expenditure tracker (prototype snapshot, Nov 2026). Account in tracker: Founders wallet — Selcom Pesa. Paid by: Hamis Juma. Evidence: Sunset Terrace customer bill'),
  ('Q426-122','2026-11-13','Morogoro TIE activity accommodation','Morogoro accommodation — supplier to confirm',130000.0,'TZS','Expense','Safeguarding, Gender, & Compliance','TUSOME TIE activities','Personal','ACC-05','hamis@tusome.ac.tz','https://drive.google.com/file/d/1FknM-XPm6wvYZG8lymk4AcRvc5GCJKMc/view','Approved','Approved in the expenditure tracker by Hamis Juma','Hamis Juma','Imported from the expenditure tracker (prototype snapshot, Nov 2026). Account in tracker: Founders wallet — cash. Paid by: Hamis Juma. Evidence: 2026-11-10_Petty-Cash-0015_Morogoro_Accommodation-Incidentals_TZS490000.pdf'),
  ('Q426-123','2026-11-14','Morogoro TIE activity accommodation','Morogoro accommodation — supplier to confirm',130000.0,'TZS','Expense','Safeguarding, Gender, & Compliance','TUSOME TIE activities','Personal','ACC-05','hamis@tusome.ac.tz','https://drive.google.com/file/d/1FknM-XPm6wvYZG8lymk4AcRvc5GCJKMc/view','Approved','Approved in the expenditure tracker by Hamis Juma','Hamis Juma','Imported from the expenditure tracker (prototype snapshot, Nov 2026). Account in tracker: Founders wallet — cash. Paid by: Hamis Juma. Evidence: 2026-11-10_Petty-Cash-0015_Morogoro_Accommodation-Incidentals_TZS490000.pdf'),
  ('Q426-124','2026-11-15','Morogoro TIE activity accommodation','Morogoro accommodation — supplier to confirm',130000.0,'TZS','Expense','Safeguarding, Gender, & Compliance','TUSOME TIE activities','Personal','ACC-05','hamis@tusome.ac.tz','https://drive.google.com/file/d/1FknM-XPm6wvYZG8lymk4AcRvc5GCJKMc/view','Approved','Approved in the expenditure tracker by Hamis Juma','Hamis Juma','Imported from the expenditure tracker (prototype snapshot, Nov 2026). Account in tracker: Founders wallet — cash. Paid by: Hamis Juma. Evidence: 2026-11-10_Petty-Cash-0015_Morogoro_Accommodation-Incidentals_TZS490000.pdf'),
  ('Q426-125','2026-11-15','Morogoro TIE activity local transport','Morogoro local transport — payees to confirm',100000.0,'TZS','Expense','Safeguarding, Gender, & Compliance','TUSOME TIE activities','Personal','ACC-05','hamis@tusome.ac.tz','https://drive.google.com/file/d/1FknM-XPm6wvYZG8lymk4AcRvc5GCJKMc/view','Approved','Approved in the expenditure tracker by Hamis Juma','Hamis Juma','Imported from the expenditure tracker (prototype snapshot, Nov 2026). Account in tracker: Founders wallet — cash. Paid by: Hamis Juma. Evidence: 2026-11-10_Petty-Cash-0015_Morogoro_Accommodation-Incidentals_TZS490000.pdf'),
  ('Q426-126','2026-11-15','Morogoro TIE activity travel meal','Sunset Terrace',13000.0,'TZS','Expense','Safeguarding, Gender, & Compliance','TUSOME TIE activities','Personal','ACC-05','hamis@tusome.ac.tz','https://drive.google.com/file/d/1t27HHYrWnvP8hzkLYHy_rpkkrI-G8-VT/view','Approved','Approved in the expenditure tracker by Hamis Juma','Hamis Juma','Imported from the expenditure tracker (prototype snapshot, Nov 2026). Account in tracker: Founders wallet — cash. Paid by: Hamis Juma. Evidence: Sunset Terrace order 261115-00061'),
  ('Q426-127','2026-11-11','AI RCT endline examination supervision','Amour Amour',25000.0,'TZS','Expense','M&E, Reporting, and Legal Support','AI RCT Zanzibar endline','Company','ACC-02',null,'https://drive.google.com/file/d/1fumewbSv-yh6cdurORxvUNgazj5xzT_m/view?usp=drivesdk','Submitted',null,null,'Imported from the expenditure tracker (prototype snapshot, Nov 2026). Account in tracker: Hamis Selcom (PesaPal-funded). Paid by: Hamis Juma. Evidence: 2026-11-17_Selcom_111710W2AY_Amour_Amour_AI-RCT_TZS25000.jpeg'),
  ('Q426-128','2026-11-11','AI RCT endline examination supervision','Juma Ali',25000.0,'TZS','Expense','M&E, Reporting, and Legal Support','AI RCT Zanzibar endline','Company','ACC-02',null,'https://drive.google.com/file/d/16ag-fx1GHFC7ZDIOpKeahnUKMevPdfpM/view?usp=drivesdk','Submitted',null,null,'Imported from the expenditure tracker (prototype snapshot, Nov 2026). Account in tracker: Hamis Selcom (PesaPal-funded). Paid by: Hamis Juma. Evidence: 2026-11-17_Selcom_111710W2H7_Juma_Ali_AI-RCT_TZS25000.jpeg'),
  ('Q426-129','2026-11-11','AI RCT endline examination supervision','Asaa Is Haka Asaa',25000.0,'TZS','Expense','M&E, Reporting, and Legal Support','AI RCT Zanzibar endline','Company','ACC-02',null,'https://drive.google.com/file/d/1KJmDz5d8LtiKUqFcpWQEPjf-bbsD6GBG/view?usp=drivesdk','Submitted',null,null,'Imported from the expenditure tracker (prototype snapshot, Nov 2026). Account in tracker: Hamis Selcom (PesaPal-funded). Paid by: Hamis Juma. Evidence: 2026-11-17_Selcom_111710W3FF_Asaa_Is_Haka_Asaa_AI-RCT_TZS25000.jpeg'),
  ('Q426-130','2026-11-11','AI RCT endline examination supervision','Hafidh Faki',25000.0,'TZS','Expense','M&E, Reporting, and Legal Support','AI RCT Zanzibar endline','Company','ACC-02',null,'https://drive.google.com/file/d/1TCKf190DWwBU0rZjouLGBsBNfwqEM10h/view?usp=drivesdk','Submitted',null,null,'Imported from the expenditure tracker (prototype snapshot, Nov 2026). Account in tracker: Hamis Selcom (PesaPal-funded). Paid by: Hamis Juma. Evidence: 2026-11-17_Selcom_111710W3PV_Hafidh_Faki_AI-RCT_TZS25000.jpeg'),
  ('Q426-131','2026-11-11','AI RCT endline examination supervision','Juma Faki',25000.0,'TZS','Expense','M&E, Reporting, and Legal Support','AI RCT Zanzibar endline','Company','ACC-02',null,'https://drive.google.com/file/d/1eHIH7lL8PhyUUN-TrsDBUcVM_PzdwTc4/view?usp=drivesdk','Submitted',null,null,'Imported from the expenditure tracker (prototype snapshot, Nov 2026). Account in tracker: Hamis Selcom (PesaPal-funded). Paid by: Hamis Juma. Evidence: 2026-11-17_Selcom_111710W3UH_Juma_Faki_AI-RCT_TZS25000.jpeg'),
  ('Q426-132','2026-11-11','AI RCT endline examination supervision','Latifa Jabir',25000.0,'TZS','Expense','M&E, Reporting, and Legal Support','AI RCT Zanzibar endline','Company','ACC-02',null,'https://drive.google.com/file/d/1jIfnj3a-fldBobqlGtdOWbW1LZjGAVTD/view?usp=drivesdk','Submitted',null,null,'Imported from the expenditure tracker (prototype snapshot, Nov 2026). Account in tracker: Hamis Selcom (PesaPal-funded). Paid by: Hamis Juma. Evidence: 2026-11-17_Selcom_111710W41C_Latifa_Jabir_AI-RCT_TZS25000.jpeg'),
  ('Q426-133','2026-11-11','AI RCT endline examination supervision','Salum Ali Juma',25000.0,'TZS','Expense','M&E, Reporting, and Legal Support','AI RCT Zanzibar endline','Company','ACC-02',null,'https://drive.google.com/file/d/1fSeUszpRw-7kATPlkLDGsk_qVnnERy2r/view?usp=drivesdk','Submitted',null,null,'Imported from the expenditure tracker (prototype snapshot, Nov 2026). Account in tracker: Hamis Selcom (PesaPal-funded). Paid by: Hamis Juma. Evidence: 2026-11-17_Selcom_111710W47J_Salum_Ali_Juma_AI-RCT_TZS25000.jpeg'),
  ('Q426-134','2026-11-11','AI RCT endline examination supervision','Ghanima Nassor',25000.0,'TZS','Expense','M&E, Reporting, and Legal Support','AI RCT Zanzibar endline','Company','ACC-02',null,'https://drive.google.com/file/d/1ZZ7gb74eoc-SvpC-qE_ieLho5KrdJ1UD/view?usp=drivesdk','Submitted',null,null,'Imported from the expenditure tracker (prototype snapshot, Nov 2026). Account in tracker: Hamis Selcom (PesaPal-funded). Paid by: Hamis Juma. Evidence: 2026-11-17_Selcom_111710W4DX_Ghanima_Nassor_AI-RCT_TZS25000.jpeg'),
  ('Q426-135','2026-11-11','AI RCT endline examination supervision','Abubakar Mambo',70000.0,'TZS','Expense','M&E, Reporting, and Legal Support','AI RCT Zanzibar endline','Company','ACC-02',null,'https://drive.google.com/file/d/16R2lVwEOxH9P8CSCG09U9bE0iFTUDnvZ/view?usp=drivesdk','Submitted',null,null,'Imported from the expenditure tracker (prototype snapshot, Nov 2026). Account in tracker: Hamis Selcom (PesaPal-funded). Paid by: Hamis Juma. Evidence: 2026-11-17_Selcom_111710W4MH_Abubakar_Mambo_AI-RCT_TZS70000.jpeg')
on conflict (tracker_id) do nothing;
update public.payments set imported = true, recorded_by = 'tracker import' where tracker_id is not null and recorded_by is null;

-- Admin import of further tracker months (used by the app's "Import from tracker" screen).
create or replace function public.import_payments(p_rows jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not has_role('admin') then raise exception 'Only an administrator can import'; end if;
  perform set_config('tusome.fn', '1', true);
  insert into payments (tracker_id, date, description, payee, amount, currency, kind, category, project, funding, account_id, payer,
    receipt_link, status, approval_basis, decided_by, notes, imported, recorded_by)
  select x->>'tracker_id', (x->>'date')::date, coalesce(nullif(x->>'description',''),'(no description)'), x->>'payee', (x->>'amount')::numeric,
    coalesce(nullif(x->>'currency',''),'TZS'), coalesce(nullif(x->>'kind',''),'Expense'), x->>'category', x->>'project',
    case when x->>'funding' = 'Personal' then 'Personal' else 'Company' end, nullif(x->>'account_id',''), nullif(x->>'payer',''),
    nullif(x->>'receipt_link',''), case when (x->>'approved')::boolean then 'Approved' else 'Submitted' end,
    case when (x->>'approved')::boolean then 'Approved in the expenditure tracker' end, nullif(x->>'approved_by',''),
    coalesce(x->>'notes','Imported from the expenditure tracker'), true, current_email()
  from jsonb_array_elements(p_rows) x
  where coalesce(x->>'tracker_id','') <> '' and (x->>'amount')::numeric > 0
  on conflict (tracker_id) do nothing;
  get diagnostics n = row_count;
  perform set_config('tusome.fn', '', true);
  return n;
end $$;
revoke execute on function public.import_payments(jsonb) from public, anon;
grant execute on function public.import_payments(jsonb) to authenticated;

-- Check
select funding, status, imported, count(*), sum(amount) from public.payments group by 1,2,3 order by 1,2,3;
