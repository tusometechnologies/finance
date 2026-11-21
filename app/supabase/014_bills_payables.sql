-- TUSOME Finance phase 4: supplier bills and accounts payable.
-- A bill is recorded when the supplier's invoice arrives, approved under the same rules as payments,
-- posted to Accounts payable (2000), and then paid in full or in part from a company account.
-- Chain checked: contract -> bill -> approval -> payment -> proof.
-- Run once after 013: Supabase > SQL Editor > New query > paste > Run.

create sequence if not exists public.bill_seq;
create sequence if not exists public.bpy_seq;

create table public.bills (
  id text primary key,                                  -- BILL-YYYY-0001, set by the database
  supplier_id text not null references public.suppliers(id),
  supplier_ref text,                                    -- the supplier's own invoice number
  date date not null default current_date,              -- date on the supplier's invoice
  due_date date,
  currency text not null default 'TZS' check (currency in ('TZS','USD')),
  lines jsonb not null default '[]',                    -- [{description, account, amount, vat}] amount before VAT
  project text,
  request_id text references public.requests(id),
  contract_id text references public.contracts(id),
  envelope_id text references public.envelopes(id),
  attachment_link text,                                 -- the supplier's invoice (scan or PDF)
  wht_rate numeric not null default 0 check (wht_rate >= 0 and wht_rate < 1),
  subtotal numeric not null default 0, vat numeric not null default 0, total numeric not null default 0,
  wht numeric not null default 0, payable numeric not null default 0,   -- payable = total - tax TUSOME withholds
  fx_rate numeric,
  status text not null default 'Draft' check (status in ('Draft','Submitted','Approved','Rejected','Void')),
  approval_basis text, flags text[] not null default '{}',
  decided_by text, decided_at timestamptz, decision_comment text,
  notes text,
  recorded_by text, recorded_at timestamptz not null default now(),
  void_reason text, voided_by text, voided_at timestamptz
);
create index bills_supplier on public.bills(supplier_id);

create table public.bill_payments (
  id text primary key default ('BPY-' || extract(year from now())::int || '-' || lpad(nextval('public.bpy_seq')::text, 4, '0')),
  bill_id text not null references public.bills(id),
  date date not null,
  amount numeric not null check (amount > 0),           -- in the bill's currency
  currency text not null,
  account_id text not null references public.accounts(id),
  reference text, proof_link text,
  status text not null default 'Posted' check (status in ('Posted','Void')),
  recorded_by text not null, recorded_at timestamptz not null default now(),
  void_reason text
);

create or replace function public.bill_paid(p_bill text) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(sum(amount), 0) from bill_payments where bill_id = p_bill and status = 'Posted'
$$;

-- Envelopes now also count bills raised directly against them (not under a request).
create or replace function public.envelope_used(p_env text, p_ex_req text, p_ex_pay text) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce((select sum(request_tzs(r)) from requests r
           where r.details->>'envelopeId' = p_env and r.submitted and r.id is distinct from p_ex_req
             and not exists (select 1 from approvals a where a.request_id = r.id and a.rev = r.rev and a.decision = 'Rejected')), 0)
       + coalesce((select sum(tzs_of(p.amount, p.currency, p.date)) from payments p
           where p.envelope_id = p_env and p.request_id is null and p.status <> 'Rejected' and p.id is distinct from p_ex_pay), 0)
       + coalesce((select sum(tzs_of(b.total, b.currency, b.date)) from bills b
           where b.envelope_id = p_env and b.request_id is null and b.status in ('Submitted','Approved') and b.id is distinct from p_ex_pay), 0)
$$;

-- Totals, checks and the approval basis are always set by the database.
create or replace function public.bills_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare me text := current_email(); l jsonb; sub numeric := 0; v numeric := 0; rate numeric; vreg boolean; a gl_accounts;
        r requests; c jsonb; basis text; fl text[] := '{}'; used numeric; cap numeric; terms int;
begin
  if in_fn() then return new; end if;
  if tg_op = 'UPDATE' then
    if old.status in ('Approved','Void') then
      if (new.supplier_id, new.supplier_ref, new.date, new.due_date, new.currency, new.lines, new.project, new.request_id, new.contract_id, new.envelope_id, new.wht_rate, new.status)
         is distinct from (old.supplier_id, old.supplier_ref, old.date, old.due_date, old.currency, old.lines, old.project, old.request_id, old.contract_id, old.envelope_id, old.wht_rate, old.status) then
        raise exception 'An approved bill can only have its attachment or notes changed. Void it and record it again if it is wrong.'; end if;
      new.id := old.id; new.recorded_by := old.recorded_by; new.recorded_at := old.recorded_at; new.subtotal := old.subtotal; new.vat := old.vat; new.total := old.total;
      new.wht := old.wht; new.payable := old.payable; new.fx_rate := old.fx_rate; new.approval_basis := old.approval_basis; new.flags := old.flags;
      new.decided_by := old.decided_by; new.decided_at := old.decided_at; new.decision_comment := old.decision_comment;
      new.void_reason := old.void_reason; new.voided_by := old.voided_by; new.voided_at := old.voided_at;
      if coalesce(btrim(new.attachment_link),'') = '' then raise exception 'Keep a link to the supplier''s invoice'; end if;
      return new;
    end if;
    new.id := old.id; new.recorded_by := old.recorded_by; new.recorded_at := old.recorded_at;
  else
    new.id := null;                  -- numbered only once every check has passed, so failed attempts leave no gaps
    new.recorded_by := coalesce(me, new.recorded_by, 'system'); new.recorded_at := now();
  end if;
  new.void_reason := null; new.voided_by := null; new.voided_at := null;
  if new.status not in ('Draft','Submitted') then new.status := 'Submitted'; end if;

  -- totals
  select coalesce((company->>'vat_rate')::numeric, 0.18), coalesce((company->>'vat_registered')::boolean, false) into rate, vreg from settings where id = 1;
  for l in select * from jsonb_array_elements(coalesce(new.lines,'[]'::jsonb)) loop
    sub := sub + round(coalesce((l->>'amount')::numeric,0), 2);
    if coalesce((l->>'vat')::boolean, false) then v := v + round(coalesce((l->>'amount')::numeric,0) * rate, 2); end if;
  end loop;
  new.subtotal := sub; new.vat := v; new.total := sub + v;
  new.wht := round(sub * coalesce(new.wht_rate,0), 2); new.payable := new.total - new.wht;
  if new.due_date is null then
    select (data->>'paymentTermsDays')::int into terms from suppliers where id = new.supplier_id;
    new.due_date := new.date + coalesce(terms, 30); end if;

  new.approval_basis := null; new.decided_by := null; new.decided_at := null; new.decision_comment := null; new.flags := '{}';
  if new.status = 'Draft' then
    if new.id is null then new.id := 'BILL-' || extract(year from now())::int || '-' || lpad(nextval('bill_seq')::text, 4, '0'); end if;
    return new; end if;

  -- checks before a bill can be submitted
  if jsonb_array_length(coalesce(new.lines,'[]'::jsonb)) = 0 or sub <= 0 then raise exception 'Add at least one line with an amount'; end if;
  for l in select * from jsonb_array_elements(new.lines) loop
    if coalesce((l->>'amount')::numeric,0) <= 0 then raise exception 'Every line needs an amount above zero'; end if;
    select * into a from gl_accounts where code = l->>'account' and active;
    if not found or a.type not in ('Expense','Asset') or a.bank_account_id is not null then
      raise exception 'Line "%": choose an expense or asset account', coalesce(l->>'description',''); end if;
  end loop;
  if coalesce(btrim(new.attachment_link),'') = '' then raise exception 'Add a link to the supplier''s invoice'; end if;
  if coalesce(btrim(new.supplier_ref),'') = '' then raise exception 'Enter the supplier''s invoice number'; end if;
  if exists (select 1 from bills b where b.supplier_id = new.supplier_id and lower(btrim(b.supplier_ref)) = lower(btrim(new.supplier_ref))
             and b.id is distinct from new.id and b.status <> 'Void') then
    raise exception 'This supplier invoice number is already recorded (possible duplicate)'; end if;
  perform lock_check(new.date);

  -- contract: same supplier; flag if bills exceed its value
  if new.contract_id is not null then
    select data into c from contracts where id = new.contract_id;
    if nullif(c->>'supplierId','') is not null and c->>'supplierId' <> new.supplier_id then raise exception 'That contract is with a different supplier'; end if;
    if coalesce(c->>'status','') in ('Expired','Terminated','Closed') then fl := fl || ('Contract is ' || lower(c->>'status')); end if;
    if coalesce((c->>'value')::numeric,0) > 0 then
      select coalesce(sum(tzs_of(total, currency, date)),0) into used from bills where contract_id = new.contract_id and id is distinct from new.id and status in ('Submitted','Approved');
      if used + tzs_of(new.total, new.currency, new.date) > tzs_of((c->>'value')::numeric, coalesce(c->>'currency','TZS'), new.date) * 1.0001 then
        fl := fl || 'Bills exceed the contract value'::text; end if;
    end if;
  end if;
  if not exists (select 1 from suppliers s where s.id = new.supplier_id and coalesce(s.data->>'callback','No') = 'Yes' and coalesce(s.data->>'tin','') <> '') then
    fl := fl || 'Supplier not verified (TIN and call-back)'::text; end if;

  -- approval basis: an approved request (within its amount) or a pre-approved envelope; otherwise a decision
  if new.request_id is not null then
    select * into r from requests where id = new.request_id;
    if not chain_complete(r) then raise exception 'That purchase request is not fully approved yet'; end if;
    select coalesce(sum(tzs_of(total, currency, date)),0) into used from bills where request_id = r.id and id is distinct from new.id and status in ('Submitted','Approved');
    cap := request_tzs(r) * 1.05;
    if used + tzs_of(new.total, new.currency, new.date) > cap then fl := fl || 'Bills exceed the approved request by more than 5%'::text;
    else basis := 'Purchase request ' || r.id; end if;
  elsif envelope_covers(new.envelope_id, tzs_of(new.total, new.currency, new.date), null, new.id) then
    basis := 'Pre-approved envelope ' || new.envelope_id;
  end if;
  if basis is not null and array_length(fl,1) is null then
    new.status := 'Approved'; new.approval_basis := basis; new.decided_by := 'automatic'; new.decided_at := now();
  else
    new.status := 'Submitted';
  end if;
  new.flags := fl;
  if new.id is null then new.id := 'BILL-' || extract(year from now())::int || '-' || lpad(nextval('bill_seq')::text, 4, '0'); end if;
  return new;
end $$;
create trigger bills_guard before insert or update on public.bills for each row execute function public.bills_guard();

-- Approve or reject a bill: same rules as payments. Nobody decides a bill they recorded.
create or replace function public.decide_bill(p_id text, p_decision text, p_comment text default '')
returns void language plpgsql security definer set search_path = public as $$
declare b bills; me text := current_email(); usd numeric; thr numeric;
begin
  select * into b from bills where id = p_id for update;
  if not found then raise exception 'Bill not found'; end if;
  if b.status <> 'Submitted' then raise exception 'Only bills awaiting approval can be decided'; end if;
  if me = b.recorded_by then raise exception 'You cannot approve a bill you recorded'; end if;
  if p_decision not in ('Approved','Rejected') then raise exception 'Invalid decision'; end if;
  if coalesce(btrim(p_comment),'') = '' and (p_decision = 'Rejected' or array_length(b.flags,1) > 0) then
    raise exception 'Give a reason (required when rejecting, or when approving a bill with warnings)'; end if;
  select threshold_usd into thr from settings where id = 1;
  usd := usd_of(b.total, b.currency, b.date);
  if usd is not null and usd > thr then
    if is_director(b.recorded_by) then
      if not (has_role('alt_director') or has_role('director')) then raise exception 'The Director''s own bills above USD % need the alternate approver', thr; end if;
    elsif not has_role('director') then raise exception 'Bills above USD % need the Director', thr; end if;
  elsif not has_any_role(array['approver','director']) then
    raise exception 'Only a Band 1-2 approver or the Director can decide bills up to USD %', thr;
  end if;
  perform set_config('tusome.fn', '1', true);
  update bills set status = p_decision, decided_by = me, decided_at = now(), decision_comment = coalesce(p_comment,''),
    approval_basis = case when p_decision = 'Approved' then 'Decision by ' || me else null end where id = p_id;
  perform set_config('tusome.fn', '', true);
end $$;

-- Post an approved bill: Dr expense/asset (and input VAT if VAT-registered), Cr Accounts payable, Cr WHT payable.
create or replace function public.post_bill(p_id text) returns text
language plpgsql security definer set search_path = public as $$
declare b bills; jid text; rate numeric; l jsonb; vreg boolean; vrate numeric; amt numeric; lv numeric; sname text;
begin
  select * into b from bills where id = p_id;
  if not found or b.status <> 'Approved' then return null; end if;
  if exists (select 1 from journals where source = 'bill' and source_id = b.id and status = 'Posted') then return null; end if;
  select coalesce((company->>'vat_registered')::boolean,false), coalesce((company->>'vat_rate')::numeric,0.18) into vreg, vrate from settings where id = 1;
  select coalesce(data->>'name', b.supplier_id) into sname from suppliers where id = b.supplier_id;
  rate := case when b.currency = 'USD' then fx_rate_on(b.date) else 1 end;
  perform set_config('tusome.fn', '1', true);
  update bills set fx_rate = rate where id = b.id;
  perform set_config('tusome.fn', '', true);
  jid := new_journal(b.date, 'Bill ' || b.id || ' · ' || sname || coalesce(' · ' || b.supplier_ref, ''), 'bill', b.id);
  for l in select * from jsonb_array_elements(b.lines) loop
    amt := round((l->>'amount')::numeric, 2);
    lv := case when coalesce((l->>'vat')::boolean,false) then round(amt * vrate, 2) else 0 end;
    -- not VAT-registered: the VAT is part of the cost
    perform add_line(jid, l->>'account', coalesce(l->>'description', 'Bill ' || b.id), (amt + case when vreg then 0 else lv end) * rate, 0,
                     b.currency, amt + case when vreg then 0 else lv end, rate, coalesce(nullif(l->>'project',''), b.project), sname, b.envelope_id);
  end loop;
  if vreg and b.vat > 0 then perform add_line(jid, '1200', 'Input VAT · ' || coalesce(b.supplier_ref,''), b.vat * rate, 0, b.currency, b.vat, rate, b.project, sname, null); end if;
  perform add_line(jid, '2000', 'Owed to ' || sname || coalesce(' · ' || b.supplier_ref, ''), 0, b.payable * rate, b.currency, b.payable, rate, b.project, sname, null);
  if b.wht > 0 then perform add_line(jid, '2200', 'Withholding tax on ' || coalesce(b.supplier_ref, b.id) || ' (' || round(b.wht_rate*100,2) || '%)', 0, b.wht * rate, b.currency, b.wht, rate, b.project, sname, null); end if;
  return jid;
end $$;

create or replace function public.bills_post_trg() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'Approved' and (tg_op = 'INSERT' or old.status <> 'Approved') then perform post_bill(new.id); end if;
  return null;
end $$;
create trigger bills_post after insert or update of status on public.bills for each row execute function public.bills_post_trg();

-- Void an approved bill that has no payments: reverses its entry.
create or replace function public.void_bill(p_id text, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare b bills; jid text;
begin
  if not keeps_books() then raise exception 'Only an administrator or the Finance custodian can void bills'; end if;
  if coalesce(btrim(p_reason),'') = '' then raise exception 'Give a reason'; end if;
  select * into b from bills where id = p_id for update;
  if not found or b.status = 'Void' then raise exception 'Bill not found or already void'; end if;
  if bill_paid(b.id) > 0 then raise exception 'This bill has payments. Void the payments first.'; end if;
  select id into jid from journals where source = 'bill' and source_id = b.id and status = 'Posted';
  if jid is not null then perform reverse_journal_internal(jid, current_date, 'bill voided: ' || p_reason); end if;
  perform set_config('tusome.fn', '1', true);
  update bills set status = 'Void', void_reason = p_reason, voided_by = current_email(), voided_at = now() where id = p_id;
  perform set_config('tusome.fn', '', true);
end $$;

-- Pay a bill, in full or in part, from a company account. Dr Accounts payable (at the bill's rate), Cr bank, FX difference.
create or replace function public.record_bill_payment(p jsonb) returns text
language plpgsql security definer set search_path = public as $$
declare me text := current_email(); b bills; bank text; amt numeric := (p->>'amount')::numeric; d date := coalesce((p->>'date')::date, current_date);
        bal numeric; rate numeric; brate numeric; diff numeric; jid text; pid text; sname text;
begin
  if not keeps_books() then raise exception 'Only an administrator or the Finance custodian can pay bills'; end if;
  select * into b from bills where id = p->>'bill_id' for update;
  if not found or b.status <> 'Approved' then raise exception 'Only approved bills can be paid'; end if;
  if coalesce(amt,0) <= 0 then raise exception 'Enter the amount paid'; end if;
  bal := b.payable - bill_paid(b.id);
  if amt > bal + 0.005 then raise exception 'More than the balance owed (% %)', b.currency, round(bal,2); end if;
  bank := gl_for_bank(p->>'account_id');
  if bank is null then raise exception 'Choose a company bank or wallet that is linked to the chart of accounts'; end if;
  if coalesce(btrim(p->>'proof_link'),'') = '' then raise exception 'Add a link to the proof of payment'; end if;
  select coalesce(data->>'name', b.supplier_id) into sname from suppliers where id = b.supplier_id;
  insert into bill_payments(bill_id, date, amount, currency, account_id, reference, proof_link, recorded_by)
  values (b.id, d, amt, b.currency, p->>'account_id', nullif(p->>'reference',''), p->>'proof_link', me) returning id into pid;
  rate := case when b.currency = 'USD' then fx_rate_on(d) else 1 end; brate := coalesce(b.fx_rate, 1);
  jid := new_journal(d, 'Payment to ' || sname || ' · ' || b.id || coalesce(' · ' || b.supplier_ref, ''), 'bill_payment', pid);
  perform add_line(jid, '2000', 'Settles ' || b.id, amt * brate, 0, b.currency, amt, brate, b.project, sname, null);
  perform add_line(jid, bank, 'Paid ' || coalesce(nullif(p->>'reference',''), sname), 0, amt * rate, b.currency, amt, rate, b.project, sname, null);
  diff := round(amt * rate - amt * brate, 2);
  if diff > 0 then perform add_line(jid, '6950', 'FX loss on ' || b.id, diff, 0, 'TZS', null, null, b.project, sname, null);
  elsif diff < 0 then perform add_line(jid, '4950', 'FX gain on ' || b.id, 0, -diff, 'TZS', null, null, b.project, sname, null); end if;
  return pid;
end $$;

create or replace function public.void_bill_payment(p_id text, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare jid text;
begin
  if not keeps_books() then raise exception 'Not allowed'; end if;
  if coalesce(btrim(p_reason),'') = '' then raise exception 'Give a reason'; end if;
  update bill_payments set status = 'Void', void_reason = p_reason where id = p_id and status = 'Posted';
  if not found then raise exception 'Payment not found or already void'; end if;
  select id into jid from journals where source = 'bill_payment' and source_id = p_id and status = 'Posted';
  if jid is not null then perform reverse_journal_internal(jid, current_date, 'bill payment voided: ' || p_reason); end if;
end $$;

alter table public.journals drop constraint journals_source_check;
alter table public.journals add constraint journals_source_check
  check (source in ('payment','repayment','opening','manual','reversal','invoice','receipt','bank','bill','bill_payment'));

-- ---------- security, audit, live updates ----------
alter table public.bills enable row level security;
alter table public.bill_payments enable row level security;
create policy read_bills on public.bills for select to authenticated
  using (is_member() and (sees_books() or recorded_by = current_email() or has_any_role(array['approver','director','alt_director'])));
create policy ins_bills on public.bills for insert to authenticated with check (can_write());
create policy upd_bills on public.bills for update to authenticated
  using ((recorded_by = current_email() and status in ('Draft','Submitted','Rejected')) or keeps_books()) with check (can_write());
create policy del_bills on public.bills for delete to authenticated
  using (status = 'Draft' and (recorded_by = current_email() or keeps_books()));
grant select, insert, update, delete on public.bills to authenticated;
create policy read_bill_payments on public.bill_payments for select to authenticated
  using (exists (select 1 from bills b where b.id = bill_id));   -- visible wherever the bill is
grant select on public.bill_payments to authenticated;
revoke all on public.bills, public.bill_payments from anon;
revoke execute on function public.decide_bill(text,text,text), public.void_bill(text,text), public.record_bill_payment(jsonb), public.void_bill_payment(text,text) from public, anon;
grant execute on function public.decide_bill(text,text,text), public.void_bill(text,text), public.record_bill_payment(jsonb), public.void_bill_payment(text,text),
  public.bill_paid(text) to authenticated;
create trigger audit_bills after insert or update or delete on public.bills for each row execute function public.audit_row();
create trigger audit_bill_payments after insert or update or delete on public.bill_payments for each row execute function public.audit_row();
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.bills, public.bill_payments; end if; end $$;

select 'phase 4 ready' as result;
