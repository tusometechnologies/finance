-- TUSOME Finance: accounting core (double entry).
-- Chart of accounts, journals and journal lines, automatic posting of approved payments, repayments and opening balances,
-- manual journals, reversals and a period lock. Base currency TZS; USD converted at the approval FX rate on the date.
-- Run once after 001-010: Supabase > SQL Editor > New query > paste > Run.

-- ---------- 0. who may see and keep the books ----------
create or replace function public.sees_books() returns boolean
language sql stable security definer set search_path = public as $$
  select has_any_role(array['admin','director','alt_director','custodian','auditor'])
$$;
create or replace function public.keeps_books() returns boolean
language sql stable security definer set search_path = public as $$
  select has_any_role(array['admin','custodian'])
$$;
alter table public.settings add column if not exists lock_date date;

-- ---------- 1. chart of accounts ----------
create table public.gl_accounts (
  code text primary key,
  name text not null,
  type text not null check (type in ('Asset','Liability','Equity','Income','Expense')),
  subtype text,
  bank_account_id text references public.accounts(id),   -- link to a bank / wallet record
  description text,
  active boolean not null default true,
  system boolean not null default false                  -- used by automatic posting; cannot be deactivated
);
insert into public.gl_accounts (code, name, type, subtype, bank_account_id, system, description) values
  ('1000','Petty cash','Asset','Cash','ACC-04',true,'Petty cash float'),
  ('1010','ABSA bank account','Asset','Bank','ACC-01',true,null),
  ('1020','PesaPal','Asset','Bank','ACC-02',true,'Payment gateway balance'),
  ('1030','Company mobile-money wallet','Asset','Bank','ACC-03',true,null),
  ('1100','Accounts receivable','Asset','Receivable',null,true,'Money clients owe TUSOME'),
  ('1200','VAT receivable (input VAT)','Asset','Current asset',null,true,null),
  ('1300','Staff advances','Asset','Current asset',null,true,'Money advanced to staff, to be accounted for'),
  ('1400','Prepayments','Asset','Current asset',null,true,'Deposits and amounts paid in advance'),
  ('1500','Equipment','Asset','Fixed asset',null,true,null),
  ('1510','Accumulated depreciation: equipment','Asset','Fixed asset',null,true,null),
  ('1999','Suspense (to classify)','Asset','Current asset',null,true,'Postings whose account could not be determined'),
  ('2000','Accounts payable','Liability','Payable',null,true,'Supplier bills not yet paid'),
  ('2100','Staff reimbursements payable','Liability','Current liability',null,true,'Money staff paid personally, owed back'),
  ('2110','Amounts due to directors','Liability','Current liability',null,true,'Money directors paid personally, owed back'),
  ('2200','Withholding tax payable','Liability','Current liability',null,true,null),
  ('2210','PAYE payable','Liability','Current liability',null,true,null),
  ('2220','NSSF payable','Liability','Current liability',null,true,null),
  ('2230','SDL payable','Liability','Current liability',null,true,null),
  ('2240','WCF payable','Liability','Current liability',null,true,null),
  ('2300','VAT payable (output VAT)','Liability','Current liability',null,true,null),
  ('2400','Accrued expenses','Liability','Current liability',null,true,null),
  ('2500','Income received in advance','Liability','Current liability',null,true,'Grants and client payments not yet earned'),
  ('3000','Share capital','Equity','Equity',null,true,null),
  ('3100','Founders'' contributions','Equity','Equity',null,true,'Company costs met from founders'' own funds and not owed back'),
  ('3200','Retained earnings','Equity','Equity',null,true,null),
  ('3900','Opening balance equity','Equity','Equity',null,true,'Balancing account for opening balances'),
  ('4000','Consulting and research income','Income','Revenue',null,true,null),
  ('4100','EdTech and product income','Income','Revenue',null,true,'Including TABASAM'),
  ('4200','Training income','Income','Revenue',null,true,null),
  ('4300','Grant income','Income','Revenue',null,true,null),
  ('4900','Other income','Income','Other income',null,true,null),
  ('4950','Foreign exchange gains','Income','Other income',null,true,null),
  ('6000','Operations and essential costs','Expense','Overhead',null,true,null),
  ('6100','Training and staff development','Expense','Expense',null,true,null),
  ('6200','M&E, reporting and legal support','Expense','Direct cost',null,true,null),
  ('6300','Product development and technology','Expense','Expense',null,true,'Including software subscriptions'),
  ('6400','Marketing and user acquisition','Expense','Expense',null,true,null),
  ('6500','Safeguarding, gender and compliance','Expense','Expense',null,true,null),
  ('6700','Salaries and wages','Expense','Expense',null,true,null),
  ('6710','Employer statutory contributions','Expense','Expense',null,true,'NSSF employer, SDL, WCF'),
  ('6800','Bank and payment charges','Expense','Overhead',null,true,null),
  ('6900','Depreciation','Expense','Overhead',null,true,null),
  ('6950','Foreign exchange losses','Expense','Overhead',null,true,null),
  ('6990','Other expenses (to classify)','Expense','Expense',null,true,null);

-- workplan category -> expense account (administrators can change these)
create table public.gl_category_map (category text primary key, account_code text not null references public.gl_accounts(code));
insert into public.gl_category_map values
  ('Operations & Essential Costs','6000'),('Training','6100'),('M&E, Reporting, and Legal Support','6200'),
  ('Product Development & Tech Improvements','6300'),('Marketing & User Acquisition','6400'),('Safeguarding, Gender, & Compliance','6500');

-- ---------- 2. journals ----------
create sequence if not exists public.jnl_seq;
create table public.journals (
  id text primary key,
  date date not null,
  memo text not null,
  source text not null check (source in ('payment','repayment','opening','manual','reversal')),
  source_id text,
  status text not null default 'Posted' check (status in ('Posted','Reversed')),
  reversal_of text references public.journals(id),
  reversed_by text,
  created_by text not null,
  created_at timestamptz not null default now()
);
create unique index journals_one_live_per_source on public.journals (source, source_id) where status = 'Posted' and source in ('payment','repayment','opening');
create table public.journal_lines (
  id bigint generated always as identity primary key,
  journal_id text not null references public.journals(id) on delete cascade,
  account_code text not null references public.gl_accounts(code),
  description text,
  debit numeric not null default 0 check (debit >= 0),
  credit numeric not null default 0 check (credit >= 0),
  currency text not null default 'TZS',
  amount_fc numeric,            -- amount in the original currency
  fx_rate numeric,
  project text, contact text, envelope_id text,
  check (debit = 0 or credit = 0)
);
create index journal_lines_journal on public.journal_lines(journal_id);
create index journal_lines_account on public.journal_lines(account_code);

-- every journal must balance (checked at the end of the transaction)
create or replace function public.journal_balance_check() returns trigger
language plpgsql as $$
declare d numeric; c numeric; jid text := coalesce(new.journal_id, old.journal_id);
begin
  select coalesce(sum(debit),0), coalesce(sum(credit),0) into d, c from journal_lines where journal_id = jid;
  if exists (select 1 from journals where id = jid) and round(d,2) <> round(c,2) then
    raise exception 'Journal % does not balance (debits %, credits %)', jid, round(d,2), round(c,2); end if;
  return null;
end $$;
create constraint trigger journal_balanced after insert or update or delete on public.journal_lines
  deferrable initially deferred for each row execute function public.journal_balance_check();

-- ---------- 3. posting helpers ----------
create or replace function public.lock_check(d date) returns void
language plpgsql stable security definer set search_path = public as $$
declare l date;
begin
  select lock_date into l from settings where id = 1;
  if l is not null and d <= l then raise exception 'The books are locked up to %. An administrator must move the lock date first.', l; end if;
end $$;

create or replace function public.new_journal(p_date date, p_memo text, p_source text, p_source_id text) returns text
language plpgsql security definer set search_path = public as $$
declare jid text := 'JNL-' || extract(year from p_date)::int || '-' || lpad(nextval('jnl_seq')::text, 5, '0');
begin
  perform lock_check(p_date);
  insert into journals(id, date, memo, source, source_id, created_by) values (jid, p_date, p_memo, p_source, p_source_id, coalesce(current_email(),'system'));
  return jid;
end $$;

create or replace function public.add_line(p_j text, p_acc text, p_desc text, p_dr numeric, p_cr numeric, p_cur text, p_fc numeric, p_fx numeric, p_project text, p_contact text, p_env text)
returns void language sql security definer set search_path = public as $$
  insert into journal_lines(journal_id, account_code, description, debit, credit, currency, amount_fc, fx_rate, project, contact, envelope_id)
  values (p_j, p_acc, p_desc, round(coalesce(p_dr,0),2), round(coalesce(p_cr,0),2), coalesce(p_cur,'TZS'), p_fc, p_fx, p_project, p_contact, p_env)
$$;

create or replace function public.gl_for_bank(p_acc text) returns text
language sql stable security definer set search_path = public as $$
  select code from gl_accounts where bank_account_id = p_acc and active order by code limit 1
$$;
create or replace function public.gl_payable_for(p_person text) returns text
language sql stable security definer set search_path = public as $$
  select case when is_director(p_person) or p_person = 'hamis@tusome.ac.tz' then '2110' else '2100' end
$$;
create or replace function public.gl_debit_for(p public.payments) returns text
language sql stable security definer set search_path = public as $$
  select case
    when p.kind = 'Advance' and not p.imported then '1300'   -- imported history: the tracker counted these as spent
    when p.kind = 'Bank charge' then '6800'
    else coalesce((select account_code from gl_category_map where category = p.category),
                  case when p.kind = 'Subscription' then '6300' else '6990' end) end
$$;

-- Post one approved payment.
create or replace function public.post_payment(p_id text) returns text
language plpgsql security definer set search_path = public as $$
declare p payments; jid text; rate numeric; base numeric; dr text; cr text; who text;
begin
  select * into p from payments where id = p_id;
  if not found or p.status <> 'Approved' then return null; end if;
  if exists (select 1 from journals where source in ('payment','opening') and source_id = p.id and status = 'Posted') then return null; end if;
  rate := case when p.currency = 'USD' then fx_rate_on(p.date) else 1 end;
  base := p.amount * rate;
  who := coalesce(p.payer, '');
  if p.opening then
    jid := new_journal(p.date, 'Opening balance owed to ' || who, 'opening', p.id);
    perform add_line(jid, '3900', 'Opening balance: ' || p.description, base, 0, p.currency, p.amount, rate, p.project, who, null);
    perform add_line(jid, gl_payable_for(who), 'Owed to ' || who, 0, base, p.currency, p.amount, rate, p.project, who, null);
    return jid;
  end if;
  dr := gl_debit_for(p);
  if p.funding = 'Personal' then
    cr := case when p.imported then '3100' else gl_payable_for(who) end;   -- imported history: met from founders' funds
  else
    cr := coalesce(gl_for_bank(p.account_id),
                   case when p.account_id in (select id from accounts where data->>'holder' = 'Personal') then '1300' end, '1999');
  end if;
  jid := new_journal(p.date, p.description || coalesce(' · ' || p.payee, ''), 'payment', p.id);
  perform add_line(jid, dr, p.description, base, 0, p.currency, p.amount, rate, p.project, coalesce(p.payee, who), p.envelope_id);
  perform add_line(jid, cr, case when p.funding = 'Personal' then 'Paid personally by ' || who else 'Paid from ' || coalesce(p.account_id,'unknown account') end,
                   0, base, p.currency, p.amount, rate, p.project, coalesce(p.payee, who), p.envelope_id);
  return jid;
end $$;

-- Post one repayment to a staff member or director.
create or replace function public.post_repayment(p_id text) returns text
language plpgsql security definer set search_path = public as $$
declare r reimbursements; jid text; rate numeric; base numeric;
begin
  select * into r from reimbursements where id = p_id;
  if not found then return null; end if;
  if exists (select 1 from journals where source = 'repayment' and source_id = r.id and status = 'Posted') then return null; end if;
  rate := case when r.currency = 'USD' then fx_rate_on(r.date) else 1 end; base := r.amount * rate;
  jid := new_journal(r.date, 'Repayment to ' || r.claimant, 'repayment', r.id);
  perform add_line(jid, gl_payable_for(r.claimant), 'Repayment to ' || r.claimant, base, 0, r.currency, r.amount, rate, null, r.claimant, null);
  perform add_line(jid, coalesce(gl_for_bank(r.account_id), '1999'), 'Paid from ' || coalesce(r.account_id,'unknown account'), 0, base, r.currency, r.amount, rate, null, r.claimant, null);
  return jid;
end $$;

-- Reverse a journal (creates the opposite entry, dated p_date or today).
create or replace function public.reverse_journal_internal(p_id text, p_date date, p_reason text) returns text
language plpgsql security definer set search_path = public as $$
declare j journals; jid text;
begin
  select * into j from journals where id = p_id for update;
  if not found then raise exception 'Journal not found'; end if;
  if j.status = 'Reversed' then return null; end if;
  if j.source = 'reversal' then raise exception 'A reversal cannot itself be reversed'; end if;
  jid := new_journal(coalesce(p_date, current_date), 'Reversal of ' || j.id || coalesce(': ' || nullif(p_reason,''), ''), 'reversal', j.source_id);
  update journals set reversal_of = j.id where id = jid;
  insert into journal_lines(journal_id, account_code, description, debit, credit, currency, amount_fc, fx_rate, project, contact, envelope_id)
    select jid, account_code, 'Reversal: ' || coalesce(description,''), credit, debit, currency, amount_fc, fx_rate, project, contact, envelope_id
    from journal_lines where journal_id = j.id;
  update journals set status = 'Reversed', reversed_by = jid where id = j.id;
  return jid;
end $$;

create or replace function public.reverse_journal(p_id text, p_reason text) returns text
language plpgsql security definer set search_path = public as $$
begin
  if not keeps_books() then raise exception 'Only an administrator or the Finance custodian can reverse journals'; end if;
  if coalesce(btrim(p_reason),'') = '' then raise exception 'Give a reason for the reversal'; end if;
  return reverse_journal_internal(p_id, current_date, p_reason);
end $$;

-- Manual journal: p_lines = [{"account":"6000","debit":1000,"credit":0,"description":"...","project":"..."}], TZS.
create or replace function public.post_manual_journal(p_date date, p_memo text, p_lines jsonb) returns text
language plpgsql security definer set search_path = public as $$
declare jid text; l jsonb; d numeric := 0; c numeric := 0; n int := 0;
begin
  if not keeps_books() then raise exception 'Only an administrator or the Finance custodian can post journals'; end if;
  if coalesce(btrim(p_memo),'') = '' then raise exception 'Describe the journal'; end if;
  for l in select * from jsonb_array_elements(p_lines) loop
    if not exists (select 1 from gl_accounts where code = l->>'account' and active) then raise exception 'Unknown or inactive account %', l->>'account'; end if;
    d := d + coalesce((l->>'debit')::numeric,0); c := c + coalesce((l->>'credit')::numeric,0); n := n + 1;
  end loop;
  if n < 2 then raise exception 'A journal needs at least two lines'; end if;
  if round(d,2) <> round(c,2) or d = 0 then raise exception 'Debits (%) and credits (%) must be equal and not zero', round(d,2), round(c,2); end if;
  jid := new_journal(p_date, p_memo, 'manual', null);
  for l in select * from jsonb_array_elements(p_lines) loop
    perform add_line(jid, l->>'account', l->>'description', (l->>'debit')::numeric, (l->>'credit')::numeric, 'TZS', null, null, nullif(l->>'project',''), nullif(l->>'contact',''), null);
  end loop;
  return jid;
end $$;

create or replace function public.set_lock_date(p_date date) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not has_role('admin') then raise exception 'Only an administrator can change the lock date'; end if;
  update settings set lock_date = p_date where id = 1;
end $$;

-- ---------- 4. automatic posting ----------
create or replace function public.payments_post_trigger() returns trigger
language plpgsql security definer set search_path = public as $$
declare jid text;
begin
  if tg_op = 'DELETE' then
    select id into jid from journals where source in ('payment','opening') and source_id = old.id and status = 'Posted';
    if jid is not null then perform reverse_journal_internal(jid, current_date, 'payment deleted'); end if;
    return old;
  end if;
  if new.status = 'Approved' then
    if tg_op = 'UPDATE' and old.status = 'Approved' and
       (new.category, new.kind, new.project, new.payee, new.envelope_id) is distinct from (old.category, old.kind, old.project, old.payee, old.envelope_id) then
      select id into jid from journals where source in ('payment','opening') and source_id = new.id and status = 'Posted';
      if jid is not null then perform reverse_journal_internal(jid, current_date, 'payment reclassified'); end if;
    end if;
    perform post_payment(new.id);
  end if;
  return new;
end $$;
create trigger payments_post after insert or update on public.payments for each row execute function public.payments_post_trigger();
create trigger payments_unpost before delete on public.payments for each row execute function public.payments_post_trigger();

create or replace function public.repayments_post_trigger() returns trigger
language plpgsql security definer set search_path = public as $$
begin perform post_repayment(new.id); return new; end $$;
create trigger repayments_post after insert on public.reimbursements for each row execute function public.repayments_post_trigger();

-- ---------- 5. security ----------
alter table public.gl_accounts enable row level security;
alter table public.gl_category_map enable row level security;
alter table public.journals enable row level security;
alter table public.journal_lines enable row level security;
create policy read_gl on public.gl_accounts for select to authenticated using (is_member());
create policy adm_gl on public.gl_accounts for all to authenticated using (has_role('admin')) with check (has_role('admin'));
create policy read_map on public.gl_category_map for select to authenticated using (is_member());
create policy adm_map on public.gl_category_map for all to authenticated using (has_role('admin')) with check (has_role('admin'));
create policy read_journals on public.journals for select to authenticated using (sees_books());
create policy read_lines on public.journal_lines for select to authenticated using (sees_books());
grant select, insert, update, delete on public.gl_accounts, public.gl_category_map to authenticated;
grant select on public.journals, public.journal_lines to authenticated;
revoke all on public.gl_accounts, public.gl_category_map, public.journals, public.journal_lines from anon;
-- system accounts cannot be removed or switched off
create or replace function public.gl_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    if old.system or exists (select 1 from journal_lines where account_code = old.code) then raise exception 'This account is in use and cannot be deleted; deactivate it instead'; end if;
    return old;
  end if;
  if tg_op = 'UPDATE' and old.system and (not new.active or new.type <> old.type or new.code <> old.code) then
    raise exception 'System accounts keep their code and type and stay active'; end if;
  return new;
end $$;
create trigger gl_guard before update or delete on public.gl_accounts for each row execute function public.gl_guard();

do $$ declare t text; begin
  foreach t in array array['gl_accounts','gl_category_map','journals'] loop
    execute format('create trigger audit_%1$s after insert or update or delete on public.%1$s for each row execute function public.audit_row()', t);
  end loop; end $$;

revoke execute on function public.post_manual_journal(date,text,jsonb), public.reverse_journal(text,text), public.set_lock_date(date),
  public.post_payment(text), public.post_repayment(text), public.reverse_journal_internal(text,date,text), public.new_journal(date,text,text,text),
  public.add_line(text,text,text,numeric,numeric,text,numeric,numeric,text,text,text) from public, anon, authenticated;
grant execute on function public.post_manual_journal(date,text,jsonb), public.reverse_journal(text,text), public.set_lock_date(date),
  public.sees_books(), public.keeps_books() to authenticated;
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.journals, public.gl_accounts;
  end if; end $$;

-- ---------- 6. post everything already approved ----------
select count(post_payment(id)) as payments_posted from (select id from public.payments where status = 'Approved' order by date, id) x;
select count(post_repayment(id)) as repayments_posted from (select id from public.reimbursements order by date, id) x;

-- Check: the trial balance must balance.
select round(sum(debit),2) as total_debits, round(sum(credit),2) as total_credits from public.journal_lines;
