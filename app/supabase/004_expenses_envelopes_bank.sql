-- TUSOME Finance: envelopes, staff expense claims, reimbursements ("Who we owe") and bank reconciliations.
-- Run once after 001-003: Supabase > SQL Editor > New query > paste > Run.

-- ---------- helpers ----------
create or replace function public.has_any_role(rs text[]) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from members m where m.email = current_email() and m.active and m.roles && rs)
$$;
-- People who see every claim: approvers, Director, admins, custodian, auditor.
create or replace function public.sees_all_claims() returns boolean
language sql stable security definer set search_path = public as $$
  select has_any_role(array['approver','director','admin','custodian','auditor'])
$$;
-- True only inside the checked functions below (lets them change fields people cannot edit directly).
create or replace function public.in_fn() returns boolean language sql stable as $$
  select coalesce(current_setting('tusome.fn', true), '') = '1'
$$;

create sequence if not exists public.env_seq;
create sequence if not exists public.claim_seq;
create sequence if not exists public.reimb_seq;
create sequence if not exists public.rec_seq;

create or replace function public.next_id(kind text) returns text
language plpgsql security definer set search_path = public as $$
declare y text := extract(year from now())::int::text;
begin
  if not can_write() then raise exception 'Not allowed'; end if;
  if kind = 'supplier' then return 'SUP-' || lpad(nextval('sup_seq')::text, 4, '0'); end if;
  if kind = 'contract' then return 'CON-' || y || '-' || lpad(nextval('con_seq')::text, 3, '0'); end if;
  if kind = 'envelope' then return 'ENV-' || y || '-' || lpad(nextval('env_seq')::text, 3, '0'); end if;
  raise exception 'Unknown kind %', kind;
end $$;

create or replace function public.usd_of(amount numeric, currency text, d date) returns numeric
language sql stable security definer set search_path = public as $$
  select case when currency = 'USD' then amount
              when fx_rate_on(d) > 0 then amount / fx_rate_on(d) end
$$;

-- ---------- envelopes (activity budgets; admin edits) ----------
create table public.envelopes (
  id text primary key,
  name text not null,
  activity text,
  project text,
  amount numeric not null check (amount >= 0),
  currency text not null default 'TZS' check (currency in ('TZS','USD')),
  funding_source text,              -- where the money comes from (funder, client, grant, own funds)
  account_id text references public.accounts(id),   -- which bank or wallet holds it
  start_date date, end_date date,
  status text not null default 'Active' check (status in ('Active','Closed')),
  notes text,
  created_at timestamptz not null default now()
);

-- ---------- staff expense claims (paid with personal funds) ----------
create table public.claims (
  id text primary key,
  claimant text not null,            -- the claimant's email (or a name key for opening balances)
  claimant_name text,
  date date not null default current_date,
  payee text,
  description text not null,
  project text, category text,
  envelope_id text references public.envelopes(id),
  amount numeric not null check (amount > 0),
  currency text not null default 'TZS' check (currency in ('TZS','USD')),
  paid_from text,                    -- e.g. personal Selcom Pesa, personal card
  receipt_link text,
  status text not null default 'Draft' check (status in ('Draft','Submitted','Approved','Rejected','Reimbursed')),
  submitted_at timestamptz,
  decided_by text, decided_at timestamptz, decision_comment text,
  reimbursement_id text,
  opening boolean not null default false,
  notes text,
  created_at timestamptz not null default now()
);

create or replace function public.claims_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare me text := current_email();
begin
  if me is null or in_fn() then return new; end if;     -- SQL editor seeding, or a checked function
  if tg_op = 'INSERT' then
    new.id := 'EXP-' || extract(year from now())::int || '-' || lpad(nextval('claim_seq')::text, 3, '0');
    new.claimant := me;
    new.claimant_name := (select full_name from members where email = me);
    new.status := 'Draft'; new.opening := false; new.submitted_at := null;
    new.decided_by := null; new.decided_at := null; new.decision_comment := null; new.reimbursement_id := null;
    return new;
  end if;
  if old.claimant <> me then raise exception 'Only the claimant can edit a claim'; end if;
  if old.status not in ('Draft','Rejected') then raise exception 'This claim is % and can no longer be edited', old.status; end if;
  if new.status not in ('Draft','Submitted') then raise exception 'Claims are approved and reimbursed through the approval steps'; end if;
  new.id := old.id; new.claimant := old.claimant; new.claimant_name := old.claimant_name; new.opening := old.opening;
  new.reimbursement_id := old.reimbursement_id;
  if new.status = 'Submitted' then
    if coalesce(btrim(new.receipt_link), '') = '' then raise exception 'Add a link to the receipt or proof of payment before submitting'; end if;
    new.submitted_at := now(); new.decided_by := null; new.decided_at := null; new.decision_comment := null;
  else
    new.decided_by := old.decided_by; new.decided_at := old.decided_at; new.decision_comment := old.decision_comment;
  end if;
  return new;
end $$;
create trigger claims_guard before insert or update on public.claims
  for each row execute function public.claims_guard();

-- Approve or reject a submitted claim.
-- Up to the USD threshold: a Band 1-2 approver or the Director. Above it: the Director.
-- Nobody decides their own claim. A Director's own claim above the threshold goes to an approver and is flagged.
create or replace function public.decide_claim(p_id text, p_decision text, p_comment text default '')
returns void language plpgsql security definer set search_path = public as $$
declare c claims; me text := current_email(); usd numeric; thr numeric; claimant_is_dir boolean;
begin
  select * into c from claims where id = p_id for update;
  if not found then raise exception 'Claim not found'; end if;
  if c.status <> 'Submitted' then raise exception 'Only submitted claims can be decided'; end if;
  if c.claimant = me then raise exception 'You cannot approve your own claim'; end if;
  if p_decision not in ('Approved','Rejected') then raise exception 'Invalid decision'; end if;
  if p_decision = 'Rejected' and coalesce(btrim(p_comment),'') = '' then raise exception 'Give a reason for rejection'; end if;
  select threshold_usd into thr from settings where id = 1;
  usd := usd_of(c.amount, c.currency, c.date);
  claimant_is_dir := exists (select 1 from members where email = c.claimant and 'director' = any(roles));
  if usd is not null and usd > thr and not claimant_is_dir then
    if not has_role('director') then raise exception 'Claims above USD % need the Director', thr; end if;
  elsif not has_any_role(array['approver','director']) then
    raise exception 'Only a Band 1-2 approver or the Director can decide claims';
  end if;
  perform set_config('tusome.fn', '1', true);
  update claims set status = p_decision, decided_by = me, decided_at = now(),
    decision_comment = coalesce(p_comment,'') ||
      case when usd > thr and claimant_is_dir then ' [Director''s own claim above threshold: report to the Board]' else '' end
  where id = p_id;
  perform set_config('tusome.fn', '', true);
end $$;

-- ---------- reimbursements ----------
create table public.reimbursements (
  id text primary key,
  claimant text not null,
  date date not null,
  amount numeric not null check (amount > 0),
  currency text not null,
  account_id text references public.accounts(id),
  tracker_id text not null,
  claim_ids text[] not null,
  recorded_by text not null,
  created_at timestamptz not null default now()
);

-- Settle approved claims for one person. Only the Finance custodian or an admin, never for themselves.
create or replace function public.record_reimbursement(p_claim_ids text[], p_date date, p_account text, p_tracker text)
returns text language plpgsql security definer set search_path = public as $$
declare me text := current_email(); who text; cur text; total numeric; n int; rid text;
begin
  if not has_any_role(array['custodian','admin']) then raise exception 'Only the Finance custodian or an administrator can record reimbursements'; end if;
  if coalesce(btrim(p_tracker),'') = '' then raise exception 'A reimbursement needs the expenditure tracker Record ID'; end if;
  select count(*), sum(amount) into n, total from claims where id = any(p_claim_ids);
  if n = 0 or n <> array_length(p_claim_ids, 1) then raise exception 'Some claims were not found'; end if;
  if (select count(distinct claimant) from claims where id = any(p_claim_ids)) > 1 then raise exception 'Reimburse one person at a time'; end if;
  if (select count(distinct currency) from claims where id = any(p_claim_ids)) > 1 then raise exception 'Reimburse one currency at a time'; end if;
  if exists (select 1 from claims where id = any(p_claim_ids) and status <> 'Approved') then raise exception 'Only approved claims can be reimbursed'; end if;
  select claimant, currency into who, cur from claims where id = p_claim_ids[1];
  if who = me then raise exception 'You cannot reimburse yourself; another custodian or administrator must record it'; end if;
  rid := 'REI-' || extract(year from now())::int || '-' || lpad(nextval('reimb_seq')::text, 3, '0');
  insert into reimbursements(id, claimant, date, amount, currency, account_id, tracker_id, claim_ids, recorded_by)
  values (rid, who, coalesce(p_date, current_date), total, cur, nullif(p_account,''), p_tracker, p_claim_ids, me);
  perform set_config('tusome.fn', '1', true);
  update claims set status = 'Reimbursed', reimbursement_id = rid where id = any(p_claim_ids);
  perform set_config('tusome.fn', '', true);
  return rid;
end $$;

-- ---------- bank and wallet reconciliations ----------
create table public.reconciliations (
  id text primary key,
  account_id text not null references public.accounts(id),
  as_of date not null,
  statement_balance numeric not null,
  book_balance numeric not null,
  difference numeric generated always as (statement_balance - book_balance) stored,
  currency text not null default 'TZS' check (currency in ('TZS','USD')),
  statement_link text,
  explanation text,
  prepared_by text,
  prepared_at timestamptz not null default now(),
  reviewed_by text, reviewed_at timestamptz, review_comment text
);
create or replace function public.recon_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare me text := current_email();
begin
  if me is null or in_fn() then return new; end if;
  if tg_op = 'INSERT' then
    new.id := 'REC-' || extract(year from now())::int || '-' || lpad(nextval('rec_seq')::text, 3, '0');
    new.prepared_by := me; new.prepared_at := now();
    new.reviewed_by := null; new.reviewed_at := null; new.review_comment := null;
    return new;
  end if;
  if old.reviewed_by is not null then raise exception 'A reviewed reconciliation cannot be changed; add a new one'; end if;
  new.id := old.id; new.prepared_by := old.prepared_by; new.prepared_at := old.prepared_at;
  new.reviewed_by := null; new.reviewed_at := null; new.review_comment := null;
  return new;
end $$;
create trigger recon_guard before insert or update on public.reconciliations
  for each row execute function public.recon_guard();

-- An administrator other than the preparer signs off. A difference must be explained first.
create or replace function public.review_reconciliation(p_id text, p_comment text default '')
returns void language plpgsql security definer set search_path = public as $$
declare r reconciliations; me text := current_email();
begin
  if not has_role('admin') then raise exception 'Only an administrator can review reconciliations'; end if;
  select * into r from reconciliations where id = p_id for update;
  if not found then raise exception 'Reconciliation not found'; end if;
  if r.reviewed_by is not null then raise exception 'Already reviewed'; end if;
  if r.prepared_by = me then raise exception 'The preparer cannot review their own reconciliation'; end if;
  if abs(r.difference) > 0.005 and coalesce(btrim(r.explanation),'') = '' then
    raise exception 'Explain the difference before signing off'; end if;
  perform set_config('tusome.fn', '1', true);
  update reconciliations set reviewed_by = me, reviewed_at = now(), review_comment = coalesce(p_comment,'') where id = p_id;
  perform set_config('tusome.fn', '', true);
end $$;

-- ---------- audit, security, grants ----------
do $$ declare t text; begin
  foreach t in array array['envelopes','claims','reimbursements','reconciliations'] loop
    execute format('create trigger audit_%1$s after insert or update or delete on public.%1$s for each row execute function public.audit_row()', t);
  end loop; end $$;

alter table public.envelopes       enable row level security;
alter table public.claims          enable row level security;
alter table public.reimbursements  enable row level security;
alter table public.reconciliations enable row level security;

create policy read_envelopes on public.envelopes for select to authenticated using (is_member());
create policy adm_envelopes  on public.envelopes for all to authenticated using (has_role('admin')) with check (has_role('admin'));

create policy read_claims on public.claims for select to authenticated
  using (is_member() and (claimant = current_email() or sees_all_claims()));
create policy ins_claims  on public.claims for insert to authenticated with check (can_write());
create policy upd_claims  on public.claims for update to authenticated
  using (claimant = current_email() and status in ('Draft','Rejected')) with check (claimant = current_email());
create policy del_claims  on public.claims for delete to authenticated
  using (status = 'Draft' and (claimant = current_email() or has_role('admin')));

create policy read_reimb on public.reimbursements for select to authenticated
  using (is_member() and (claimant = current_email() or sees_all_claims()));

create policy read_recon on public.reconciliations for select to authenticated using (is_member());
create policy ins_recon  on public.reconciliations for insert to authenticated with check (has_any_role(array['admin','custodian']));
create policy upd_recon  on public.reconciliations for update to authenticated
  using (has_any_role(array['admin','custodian']) and reviewed_by is null) with check (has_any_role(array['admin','custodian']));

grant select, insert, update, delete on public.envelopes, public.claims, public.reconciliations to authenticated;
grant select on public.reimbursements to authenticated;
revoke all on public.envelopes, public.claims, public.reimbursements, public.reconciliations from anon;
grant usage, select on all sequences in schema public to authenticated;
revoke execute on function public.decide_claim(text,text,text), public.record_reimbursement(text[],date,text,text),
  public.review_reconciliation(text,text) from public, anon;
grant execute on function public.decide_claim(text,text,text), public.record_reimbursement(text[],date,text,text),
  public.review_reconciliation(text,text), public.next_id(text), public.has_any_role(text[]), public.sees_all_claims(),
  public.in_fn(), public.usd_of(numeric,text,date) to authenticated;

do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.envelopes, public.claims, public.reimbursements, public.reconciliations;
  end if; end $$;

-- ---------- opening balances: who we owe ----------
-- From the expenditure tracker's "Outstanding Reimbursements" as held in the prototype (snapshot to 20 Nov 2026).
-- Check each figure against the tracker before reimbursing. People without a login are keyed by name.
insert into public.claims (id, claimant, claimant_name, date, description, amount, currency, status, opening, decided_by, decided_at, notes) values
  ('OPEN-001','hamis@tusome.ac.tz','Hamis Juma','2026-11-20','Opening balance: outstanding reimbursements per expenditure tracker',441684,'TZS','Approved',true,'opening balance',now(),'Verify against the tracker before paying'),
  ('OPEN-002','joseph@tusome.ac.tz','Joseph Vicent','2026-11-20','Opening balance: outstanding reimbursements per expenditure tracker',161550,'TZS','Approved',true,'opening balance',now(),'Verify against the tracker before paying'),
  ('OPEN-003','asnes@tusome.ac.tz','Asnes','2026-11-20','Opening balance: outstanding reimbursements per expenditure tracker',56500,'TZS','Approved',true,'opening balance',now(),'Verify against the tracker before paying'),
  ('OPEN-004','name:frank','Frank','2026-11-20','Opening balance: outstanding reimbursements per expenditure tracker',34383,'TZS','Approved',true,'opening balance',now(),'No login yet. Verify against the tracker before paying'),
  ('OPEN-005','name:amriyyah','Amriyyah','2026-11-20','Opening balance: outstanding reimbursements per expenditure tracker',15000,'TZS','Approved',true,'opening balance',now(),'Confirm whether this is Amriya (finance@). Verify against the tracker before paying'),
  ('OPEN-006','name:ibrahim','Ibrahim','2026-11-20','Opening balance: outstanding reimbursements per expenditure tracker',15000,'TZS','Approved',true,'opening balance',now(),'No login yet. Verify against the tracker before paying'),
  ('OPEN-007','name:issa','Issa','2026-11-20','Opening balance: outstanding reimbursements per expenditure tracker',10000,'TZS','Approved',true,'opening balance',now(),'No login yet. Verify against the tracker before paying')
on conflict (id) do nothing;
