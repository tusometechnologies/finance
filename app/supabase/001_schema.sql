-- TUSOME Finance & Procurement: database schema, rules and audit trail.
-- Run once in Supabase: SQL Editor > New query > paste > Run.
-- All access control lives here (row-level security and checked functions), not in the browser.

create extension if not exists pgcrypto;

-- ---------- members and roles (username = email) ----------
create table public.members (
  email      text primary key check (email = lower(email)),
  full_name  text not null default '',
  roles      text[] not null default '{staff}',
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  constraint roles_valid check (roles <@ array['admin','director','approver','custodian','staff','auditor']::text[])
);

create or replace function public.current_email() returns text
language sql stable as $$ select lower(nullif(auth.jwt() ->> 'email','')) $$;

create or replace function public.has_role(r text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from members m where m.email = current_email() and m.active and r = any(m.roles))
$$;

create or replace function public.is_member() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from members m where m.email = current_email() and m.active)
$$;

-- Anyone who is a member but not only an auditor can create and edit records.
create or replace function public.can_write() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from members m where m.email = current_email() and m.active
                 and m.roles && array['admin','director','approver','custodian','staff']::text[])
$$;

-- Only emails listed in members can ever get a login.
create or replace function public.block_unlisted_signup() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from members where email = lower(new.email) and active) then
    raise exception 'This email is not registered with TUSOME Finance. Ask the administrator to add it first.';
  end if;
  return new;
end $$;
create trigger members_only before insert on auth.users
  for each row execute function public.block_unlisted_signup();

-- ---------- settings (one row) ----------
create table public.settings (
  id int primary key default 1 check (id = 1),
  fx_rates jsonb not null default '[]',
  band1_tzs numeric not null default 500000,
  threshold_usd numeric not null default 1000,
  split_days int not null default 30,
  policy_date date not null default '2026-11-04',
  contract_warn_days int not null default 30,
  wht jsonb not null default '[]',
  wht_source text not null default ''
);

-- FX rate in force on a date: latest rate on or before it, else the earliest one.
create or replace function public.fx_rate_on(d date) returns numeric
language sql stable security definer set search_path = public as $$
  with r as (select (x->>'date')::date dt, (x->>'rate')::numeric rate
             from settings, jsonb_array_elements(fx_rates) x where (x->>'rate')::numeric > 0)
  select coalesce((select rate from r where dt <= d order by dt desc limit 1),
                  (select rate from r order by dt asc limit 1))
$$;

-- ---------- master data ----------
create table public.suppliers (id text primary key, data jsonb not null default '{}', created_at timestamptz default now());
create table public.contracts (id text primary key, data jsonb not null default '{}', created_at timestamptz default now());
create table public.accounts  (id text primary key, data jsonb not null default '{}', created_at timestamptz default now());

create sequence public.sup_seq start 1;
create sequence public.con_seq start 1;
create sequence public.prq_seq start 1;
create or replace function public.next_id(kind text) returns text
language plpgsql security definer set search_path = public as $$
begin
  if not can_write() then raise exception 'Not allowed'; end if;
  if kind = 'supplier' then return 'SUP-' || lpad(nextval('sup_seq')::text, 4, '0'); end if;
  if kind = 'contract' then return 'CON-' || extract(year from now())::int || '-' || lpad(nextval('con_seq')::text, 3, '0'); end if;
  raise exception 'Unknown kind %', kind;
end $$;

-- ---------- purchase requests ----------
create table public.requests (
  id text primary key,
  requester_email text,
  date date not null default current_date,
  supplier_id text references public.suppliers(id),
  amount numeric not null check (amount > 0),
  currency text not null default 'TZS' check (currency in ('TZS','USD')),
  submitted boolean not null default false,
  submitted_at timestamptz,
  rev int not null default 1,
  retro boolean not null default false,
  details jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create or replace function public.request_band(r public.requests) returns int
language plpgsql stable security definer set search_path = public as $$
declare s settings; rate numeric; tzs numeric; usd numeric;
begin
  select * into s from settings where id = 1;
  rate := fx_rate_on(coalesce(nullif(r.details->>'fxDate','')::date, r.date));
  if r.currency = 'USD' then usd := r.amount; tzs := r.amount * rate;
  else tzs := r.amount; usd := case when rate > 0 then r.amount / rate end; end if;
  if usd is not null and usd > s.threshold_usd then return 3; end if;
  if tzs >= s.band1_tzs then return 2; end if;
  return 1;
end $$;

create table public.approvals (
  id bigint generated always as identity primary key,
  request_id text not null references public.requests(id) on delete cascade,
  rev int not null,
  step text not null check (step in ('ID','DIR')),
  decision text not null check (decision in ('Approved','Rejected')),
  comment text not null default '',
  by_email text not null,
  amount numeric, currency text, band int,
  at timestamptz not null default now(),
  unique (request_id, rev, step)
);

create or replace function public.chain_complete(r public.requests) returns boolean
language sql stable security definer set search_path = public as $$
  select (select count(*) from approvals a where a.request_id = r.id and a.rev = r.rev and a.decision = 'Approved'
          and a.step = any(case when request_band(r) = 3 then array['ID','DIR'] else array['ID'] end))
       = (case when request_band(r) = 3 then 2 else 1 end)
$$;

-- Record an approval decision. The only way to write to approvals.
create or replace function public.decide(p_request text, p_decision text, p_comment text default '')
returns void language plpgsql security definer set search_path = public as $$
declare r requests; me text := current_email(); b int; nxt text;
begin
  select * into r from requests where id = p_request for update;
  if not found then raise exception 'Request not found'; end if;
  if not r.submitted then raise exception 'This request has not been submitted'; end if;
  if r.requester_email = me then raise exception 'You cannot approve your own request'; end if;
  if exists (select 1 from approvals where request_id = r.id and rev = r.rev and decision = 'Rejected') then
    raise exception 'This request was rejected; it must be revised first'; end if;
  b := request_band(r);
  if not exists (select 1 from approvals where request_id = r.id and rev = r.rev and step = 'ID' and decision = 'Approved') then nxt := 'ID';
  elsif b = 3 and not exists (select 1 from approvals where request_id = r.id and rev = r.rev and step = 'DIR' and decision = 'Approved') then nxt := 'DIR';
  else raise exception 'The approval chain is already complete'; end if;
  if nxt = 'ID' and not has_role('approver') then raise exception 'Only a Band 1-2 approver can make this decision'; end if;
  if nxt = 'DIR' and not has_role('director') then raise exception 'Only the Director can make this decision'; end if;
  if p_decision not in ('Approved','Rejected') then raise exception 'Invalid decision'; end if;
  if p_decision = 'Rejected' and coalesce(btrim(p_comment),'') = '' then raise exception 'Give a reason for rejection'; end if;
  insert into approvals(request_id, rev, step, decision, comment, by_email, amount, currency, band)
  values (r.id, r.rev, nxt, p_decision, coalesce(p_comment,''), me, r.amount, r.currency, b);
end $$;

-- Workflow rules enforced on every insert and update of a request.
create or replace function public.requests_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare me text := current_email(); b int; nq int;
begin
  if tg_op = 'INSERT' then
    if me is not null then           -- created through the app (SQL editor seeding has no user)
      new.requester_email := me; new.submitted := false; new.rev := 1; new.retro := false;
      new.id := 'PRQ-' || extract(year from now())::int || '-' || lpad(nextval('prq_seq')::text, 3, '0');
    end if;
    return new;
  end if;
  if me is null then return new; end if;
  new.requester_email := old.requester_email; new.retro := old.retro; new.id := old.id;
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
  end if;
  -- recalling to draft starts a new revision; earlier approvals stop counting
  if old.submitted and not new.submitted then
    if old.details ? 'payment' then raise exception 'A paid request cannot be recalled'; end if;
    new.rev := old.rev + 1;
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
create trigger requests_guard before insert or update on public.requests
  for each row execute function public.requests_guard();

-- ---------- audit trail (append-only) ----------
create table public.audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor_email text,
  table_name text not null,
  row_id text,
  action text not null,
  old_data jsonb,
  new_data jsonb
);
create or replace function public.audit_row() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into audit_log(actor_email, table_name, row_id, action, old_data, new_data)
  values (coalesce(current_email(), 'system'), tg_table_name,
          coalesce(to_jsonb(new)->>'id', to_jsonb(old)->>'id', to_jsonb(new)->>'email', to_jsonb(old)->>'email'),
          tg_op,
          case when tg_op <> 'INSERT' then to_jsonb(old) end,
          case when tg_op <> 'DELETE' then to_jsonb(new) end);
  return coalesce(new, old);
end $$;
do $$ declare t text; begin
  foreach t in array array['members','settings','suppliers','contracts','accounts','requests','approvals'] loop
    execute format('create trigger audit_%1$s after insert or update or delete on public.%1$s for each row execute function public.audit_row()', t);
  end loop; end $$;

-- ---------- row-level security ----------
alter table public.members   enable row level security;
alter table public.settings  enable row level security;
alter table public.suppliers enable row level security;
alter table public.contracts enable row level security;
alter table public.accounts  enable row level security;
alter table public.requests  enable row level security;
alter table public.approvals enable row level security;
alter table public.audit_log enable row level security;

-- read: every active member (auditors included)
create policy read_members   on public.members   for select to authenticated using (is_member());
create policy read_settings  on public.settings  for select to authenticated using (is_member());
create policy read_suppliers on public.suppliers for select to authenticated using (is_member());
create policy read_contracts on public.contracts for select to authenticated using (is_member());
create policy read_accounts  on public.accounts  for select to authenticated using (is_member());
create policy read_requests  on public.requests  for select to authenticated using (is_member());
create policy read_approvals on public.approvals for select to authenticated using (is_member());
create policy read_audit     on public.audit_log for select to authenticated using (is_member());

-- write: staff for operational records; admin (Director) for rules, roles and bank accounts
create policy ins_suppliers on public.suppliers for insert to authenticated with check (can_write());
create policy upd_suppliers on public.suppliers for update to authenticated using (can_write()) with check (can_write());
create policy ins_contracts on public.contracts for insert to authenticated with check (can_write());
create policy upd_contracts on public.contracts for update to authenticated using (can_write()) with check (can_write());
create policy ins_requests  on public.requests  for insert to authenticated with check (can_write());
create policy upd_requests  on public.requests  for update to authenticated using (can_write()) with check (can_write());
create policy del_requests  on public.requests  for delete to authenticated using (has_role('admin') and not submitted);
create policy adm_accounts  on public.accounts  for all to authenticated using (has_role('admin')) with check (has_role('admin'));
create policy adm_settings  on public.settings  for update to authenticated using (has_role('admin')) with check (has_role('admin'));
create policy adm_members   on public.members   for all to authenticated using (has_role('admin')) with check (has_role('admin'));
-- approvals: no direct writes (use decide()); audit_log: no writes at all from the app

grant usage on schema public to authenticated;
grant select, insert, update, delete on public.members, public.settings, public.suppliers,
  public.contracts, public.accounts, public.requests to authenticated;
grant usage, select on all sequences in schema public to authenticated;
revoke all on public.approvals from anon, authenticated;
grant select on public.approvals to authenticated;
revoke all on public.audit_log from anon, authenticated;
grant select on public.audit_log to authenticated;
revoke all on all tables in schema public from anon;
revoke execute on function public.decide(text,text,text) from public, anon;
grant execute on function public.decide(text,text,text) to authenticated;
revoke execute on function public.next_id(text) from public, anon;
grant execute on function public.next_id(text) to authenticated;

-- live updates for the app
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.requests, public.approvals, public.suppliers,
      public.contracts, public.accounts, public.settings, public.members, public.audit_log;
  end if; end $$;
