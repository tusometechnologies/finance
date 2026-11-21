-- TUSOME Finance phase 2: customers, sales invoices, receipts (money in), withholding tax suffered, FX on settlement.
-- Run once after 011: Supabase > SQL Editor > New query > paste > Run.

-- ---------- company details printed on invoices (fill in under Rules & roles) ----------
alter table public.settings add column if not exists company jsonb not null default
  '{"legal_name":"TUSOME Technologies Limited","tin":"","vrn":"","address":"Dar es Salaam, Tanzania","email":"","phone":"","bank_details":"","vat_registered":false,"vat_rate":0.18,"payment_terms_days":30}'::jsonb;

insert into public.gl_accounts (code, name, type, subtype, system, description) values
  ('1210','Withholding tax credits','Asset','Current asset',true,'Tax withheld by clients from payments to TUSOME; offset against income tax')
on conflict (code) do nothing;

-- ---------- customers ----------
create sequence if not exists public.cus_seq;
create table public.customers (
  id text primary key default ('CUS-' || lpad(nextval('public.cus_seq')::text, 4, '0')),
  name text not null,
  type text check (type in ('Government','NGO / development partner','University / school','Company','Individual','Donor / funder','Other')),
  tin text, vrn text, contact_person text, email text, phone text, address text,
  default_income_account text references public.gl_accounts(code),
  notes text, active boolean not null default true,
  created_at timestamptz not null default now()
);

-- ---------- invoices ----------
create sequence if not exists public.inv_seq;
create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  number text unique,                       -- assigned when issued (INV-YYYY-0001), never reused
  customer_id text not null references public.customers(id),
  date date not null default current_date,
  due_date date,
  currency text not null default 'TZS' check (currency in ('TZS','USD')),
  reference text, project text,
  lines jsonb not null default '[]',        -- [{description, qty, unit_price, account, vat}] vat true/false
  subtotal numeric not null default 0, vat numeric not null default 0, total numeric not null default 0,
  status text not null default 'Draft' check (status in ('Draft','Issued','Void')),
  notes text,
  created_by text, created_at timestamptz not null default now(),
  issued_by text, issued_at timestamptz, fx_rate numeric,
  void_reason text, voided_by text, voided_at timestamptz
);

-- totals are always computed by the database
create or replace function public.invoices_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare me text := current_email(); l jsonb; sub numeric := 0; v numeric := 0; rate numeric; vreg boolean;
begin
  if tg_op = 'UPDATE' and old.status <> 'Draft' and not in_fn() then raise exception 'An issued invoice cannot be edited; void it and issue a new one'; end if;
  if tg_op = 'INSERT' and me is not null and not in_fn() then
    new.number := null; new.status := 'Draft'; new.created_by := me; new.created_at := now();
    new.issued_by := null; new.issued_at := null; new.void_reason := null;
  end if;
  if tg_op = 'UPDATE' and not in_fn() then
    new.number := old.number; new.status := old.status; new.created_by := old.created_by; new.issued_by := old.issued_by; new.issued_at := old.issued_at;
  end if;
  select coalesce((company->>'vat_rate')::numeric, 0.18), coalesce((company->>'vat_registered')::boolean, false) into rate, vreg from settings where id = 1;
  for l in select * from jsonb_array_elements(coalesce(new.lines,'[]'::jsonb)) loop
    sub := sub + round(coalesce((l->>'qty')::numeric,1) * coalesce((l->>'unit_price')::numeric,0), 2);
    if vreg and coalesce((l->>'vat')::boolean, false) then
      v := v + round(coalesce((l->>'qty')::numeric,1) * coalesce((l->>'unit_price')::numeric,0) * rate, 2); end if;
  end loop;
  new.subtotal := sub; new.vat := v; new.total := sub + v;
  if new.due_date is null then
    new.due_date := new.date + coalesce((select (company->>'payment_terms_days')::int from settings where id = 1), 30); end if;
  return new;
end $$;
create trigger invoices_guard before insert or update on public.invoices for each row execute function public.invoices_guard();

-- ---------- receipts (money received) ----------
create sequence if not exists public.rcp_seq;
create table public.receipts (
  id text primary key default ('RCP-' || extract(year from now())::int || '-' || lpad(nextval('public.rcp_seq')::text, 4, '0')),
  date date not null,
  customer_id text references public.customers(id),
  invoice_id uuid references public.invoices(id),
  amount numeric not null check (amount > 0),         -- cash received
  wht numeric not null default 0 check (wht >= 0),    -- tax the client withheld (certificate expected)
  currency text not null default 'TZS' check (currency in ('TZS','USD')),
  account_id text not null references public.accounts(id),
  income_account text references public.gl_accounts(code),  -- only when not against an invoice
  reference text, project text, notes text, wht_certificate text,
  status text not null default 'Posted' check (status in ('Posted','Void')),
  recorded_by text not null, recorded_at timestamptz not null default now(),
  void_reason text
);

create or replace function public.invoice_paid(p_inv uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(sum(amount + wht), 0) from receipts where invoice_id = p_inv and status = 'Posted'
$$;
create or replace function public.can_issue() returns boolean
language sql stable security definer set search_path = public as $$
  select has_any_role(array['admin','custodian','director'])
$$;

-- Issue an invoice: number it and post it (Dr receivables, Cr income, Cr VAT payable).
create or replace function public.issue_invoice(p_id uuid) returns text
language plpgsql security definer set search_path = public as $$
declare i invoices; me text := current_email(); jid text; rate numeric; num text; l jsonb; vrate numeric; vreg boolean; net numeric; acct text; cname text;
begin
  if not can_issue() then raise exception 'Only an administrator, the Finance custodian or the Director can issue invoices'; end if;
  select * into i from invoices where id = p_id for update;
  if not found then raise exception 'Invoice not found'; end if;
  if i.status <> 'Draft' then raise exception 'Only draft invoices can be issued'; end if;
  if i.total <= 0 or jsonb_array_length(i.lines) = 0 then raise exception 'Add at least one line with an amount'; end if;
  select name into cname from customers where id = i.customer_id;
  select coalesce((company->>'vat_rate')::numeric,0.18), coalesce((company->>'vat_registered')::boolean,false) into vrate, vreg from settings where id = 1;
  rate := case when i.currency = 'USD' then fx_rate_on(i.date) else 1 end;
  if rate is null or rate <= 0 then raise exception 'No FX rate for %', i.date; end if;
  num := 'INV-' || extract(year from i.date)::int || '-' || lpad(nextval('inv_seq')::text, 4, '0');
  jid := new_journal(i.date, 'Invoice ' || num || ' to ' || cname, 'invoice', i.id::text);
  perform add_line(jid, '1100', 'Invoice ' || num, i.total * rate, 0, i.currency, i.total, rate, i.project, cname, null);
  for l in select * from jsonb_array_elements(i.lines) loop
    net := round(coalesce((l->>'qty')::numeric,1) * coalesce((l->>'unit_price')::numeric,0), 2);
    if net = 0 then continue; end if;
    acct := coalesce(nullif(l->>'account',''), (select default_income_account from customers where id = i.customer_id), '4000');
    if not exists (select 1 from gl_accounts where code = acct and type = 'Income') then raise exception 'Line account % is not an income account', acct; end if;
    perform add_line(jid, acct, coalesce(l->>'description','') , 0, net * rate, i.currency, net, rate, i.project, cname, null);
  end loop;
  if i.vat > 0 then perform add_line(jid, '2300', 'VAT on ' || num, 0, i.vat * rate, i.currency, i.vat, rate, i.project, cname, null); end if;
  perform set_config('tusome.fn','1',true);
  update invoices set status = 'Issued', number = num, issued_by = me, issued_at = now(), fx_rate = rate where id = p_id;
  perform set_config('tusome.fn','',true);
  return num;
end $$;

create or replace function public.void_invoice(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare i invoices; jid text;
begin
  if not can_issue() then raise exception 'Only an administrator, the Finance custodian or the Director can void invoices'; end if;
  if coalesce(btrim(p_reason),'') = '' then raise exception 'Give a reason'; end if;
  select * into i from invoices where id = p_id for update;
  if i.status <> 'Issued' then raise exception 'Only issued invoices can be voided'; end if;
  if invoice_paid(p_id) > 0 then raise exception 'Void the receipts against this invoice first'; end if;
  select id into jid from journals where source = 'invoice' and source_id = p_id::text and status = 'Posted';
  if jid is not null then perform reverse_journal_internal(jid, current_date, 'invoice voided: ' || p_reason); end if;
  perform set_config('tusome.fn','1',true);
  update invoices set status = 'Void', void_reason = p_reason, voided_by = current_email(), voided_at = now() where id = p_id;
  perform set_config('tusome.fn','',true);
end $$;

-- Record money received. Against an invoice: Dr bank, Dr WHT credit, Cr receivables (at the invoice rate), FX difference to 4950/6950.
-- Not against an invoice: Dr bank, Dr WHT credit, Cr the chosen income (or other) account.
create or replace function public.record_receipt(p jsonb) returns text
language plpgsql security definer set search_path = public as $$
declare me text := current_email(); i invoices; r receipts; rid text; jid text; rate numeric; inv_rate numeric; bank text; cname text;
        amt numeric := (p->>'amount')::numeric; wht numeric := coalesce((p->>'wht')::numeric,0); bal numeric; settled_base numeric; diff numeric; d date := coalesce((p->>'date')::date, current_date);
        cur text := coalesce(nullif(p->>'currency',''),'TZS'); acct text;
begin
  if not keeps_books() then raise exception 'Only an administrator or the Finance custodian can record money received'; end if;
  if coalesce(amt,0) <= 0 then raise exception 'Enter the amount received'; end if;
  bank := gl_for_bank(p->>'account_id');
  if bank is null then raise exception 'Choose a company bank or wallet that is linked to the chart of accounts'; end if;
  if nullif(p->>'invoice_id','') is not null then
    select * into i from invoices where id = (p->>'invoice_id')::uuid for update;
    if not found or i.status <> 'Issued' then raise exception 'Choose an issued invoice'; end if;
    if i.currency <> cur then raise exception 'Receive this invoice in %', i.currency; end if;
    bal := i.total - invoice_paid(i.id);
    if amt + wht > bal + 0.005 then raise exception 'More than the balance due (% %)', i.currency, round(bal,2); end if;
  elsif nullif(p->>'income_account','') is null then raise exception 'Choose an invoice, or the account this money is for';
  end if;
  select name into cname from customers where id = coalesce(i.customer_id, nullif(p->>'customer_id',''));
  rate := case when cur = 'USD' then fx_rate_on(d) else 1 end;
  insert into receipts(date, customer_id, invoice_id, amount, wht, currency, account_id, income_account, reference, project, notes, wht_certificate, recorded_by)
  values (d, coalesce(i.customer_id, nullif(p->>'customer_id','')), i.id, amt, wht, cur, p->>'account_id', nullif(p->>'income_account',''),
          nullif(p->>'reference',''), coalesce(nullif(p->>'project',''), i.project), nullif(p->>'notes',''), nullif(p->>'wht_certificate',''), me)
  returning * into r;
  jid := new_journal(d, 'Money received' || coalesce(' from ' || cname, '') || coalesce(' · ' || i.number, ''), 'receipt', r.id);
  perform add_line(jid, bank, 'Received ' || coalesce(r.reference,''), amt * rate, 0, cur, amt, rate, r.project, cname, null);
  if wht > 0 then perform add_line(jid, '1210', 'Withholding tax deducted by client', wht * rate, 0, cur, wht, rate, r.project, cname, null); end if;
  if i.id is not null then
    inv_rate := coalesce(i.fx_rate, 1);
    settled_base := (amt + wht) * inv_rate;
    perform add_line(jid, '1100', 'Settles ' || i.number, 0, settled_base, cur, amt + wht, inv_rate, r.project, cname, null);
    diff := round((amt + wht) * rate - settled_base, 2);
    if diff > 0 then perform add_line(jid, '4950', 'FX gain on ' || i.number, 0, diff, 'TZS', null, null, r.project, cname, null);
    elsif diff < 0 then perform add_line(jid, '6950', 'FX loss on ' || i.number, -diff, 0, 'TZS', null, null, r.project, cname, null); end if;
  else
    acct := p->>'income_account';
    if not exists (select 1 from gl_accounts where code = acct and active) then raise exception 'Unknown account %', acct; end if;
    perform add_line(jid, acct, coalesce(r.notes, 'Money received'), 0, (amt + wht) * rate, cur, amt + wht, rate, r.project, cname, null);
  end if;
  return r.id;
end $$;

create or replace function public.void_receipt(p_id text, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare jid text;
begin
  if not keeps_books() then raise exception 'Only an administrator or the Finance custodian can void receipts'; end if;
  if coalesce(btrim(p_reason),'') = '' then raise exception 'Give a reason'; end if;
  if not exists (select 1 from receipts where id = p_id and status = 'Posted') then raise exception 'Receipt not found or already void'; end if;
  select id into jid from journals where source = 'receipt' and source_id = p_id and status = 'Posted';
  if jid is not null then perform reverse_journal_internal(jid, current_date, 'receipt voided: ' || p_reason); end if;
  update receipts set status = 'Void', void_reason = p_reason where id = p_id;
end $$;

-- journals may now come from invoices and receipts
alter table public.journals drop constraint journals_source_check;
alter table public.journals add constraint journals_source_check check (source in ('payment','repayment','opening','manual','reversal','invoice','receipt'));
drop index if exists public.journals_one_live_per_source;
create unique index journals_one_live_per_source on public.journals (source, source_id) where status = 'Posted' and source in ('payment','repayment','opening','invoice','receipt');

-- ---------- security ----------
alter table public.customers enable row level security;
alter table public.invoices enable row level security;
alter table public.receipts enable row level security;
create policy read_customers on public.customers for select to authenticated using (is_member());
create policy ins_customers on public.customers for insert to authenticated with check (can_write());
create policy upd_customers on public.customers for update to authenticated using (can_write()) with check (can_write());
create policy read_invoices on public.invoices for select to authenticated using (sees_books() or created_by = current_email());
create policy ins_invoices on public.invoices for insert to authenticated with check (can_write());
create policy upd_invoices on public.invoices for update to authenticated
  using (status = 'Draft' and (created_by = current_email() or keeps_books() or can_issue())) with check (can_write());
create policy del_invoices on public.invoices for delete to authenticated using (status = 'Draft' and (created_by = current_email() or keeps_books()));
create policy read_receipts on public.receipts for select to authenticated using (sees_books());
grant select, insert, update on public.customers to authenticated;
grant select, insert, update, delete on public.invoices to authenticated;
grant select on public.receipts to authenticated;
revoke all on public.customers, public.invoices, public.receipts from anon;
grant usage, select on all sequences in schema public to authenticated;
revoke execute on function public.issue_invoice(uuid), public.void_invoice(uuid,text), public.record_receipt(jsonb), public.void_receipt(text,text) from public, anon;
grant execute on function public.issue_invoice(uuid), public.void_invoice(uuid,text), public.record_receipt(jsonb), public.void_receipt(text,text),
  public.invoice_paid(uuid), public.can_issue() to authenticated;
do $$ declare t text; begin
  foreach t in array array['customers','invoices','receipts'] loop
    execute format('create trigger audit_%1$s after insert or update or delete on public.%1$s for each row execute function public.audit_row()', t);
  end loop; end $$;
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.customers, public.invoices, public.receipts;
  end if; end $$;

select 'phase 2 ready' as result;
