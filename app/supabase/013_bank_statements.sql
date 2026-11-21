-- TUSOME Finance phase 3: bank statement import and line-by-line matching against the books.
-- Run once after 012: Supabase > SQL Editor > New query > paste > Run.

create table public.bank_lines (
  id bigint generated always as identity primary key,
  account_id text not null references public.accounts(id),
  date date not null,
  description text not null default '',
  reference text,
  amount numeric not null check (amount <> 0),      -- + money in, - money out (account currency)
  balance numeric,                                  -- running balance per the statement, if given
  currency text not null default 'TZS',
  fingerprint text not null,                        -- duplicate guard
  batch text, imported_by text not null, imported_at timestamptz not null default now(),
  status text not null default 'Unmatched' check (status in ('Unmatched','Matched','Created','Ignored')),
  journal_line_id bigint references public.journal_lines(id),
  matched_by text, matched_at timestamptz, note text,
  unique (account_id, fingerprint)
);
create unique index bank_lines_one_match on public.bank_lines(journal_line_id) where journal_line_id is not null and status in ('Matched','Created');

create or replace function public.bank_gl(p_account text) returns text
language sql stable security definer set search_path = public as $$ select gl_for_bank(p_account) $$;

-- Import statement rows: [{date, description, reference, amount, balance}]. Returns how many were new.
create or replace function public.import_statement(p_account text, p_rows jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare me text := current_email(); n int; b text := 'IMP-' || to_char(now(),'YYYYMMDDHH24MISS'); cur text;
begin
  if not keeps_books() then raise exception 'Only an administrator or the Finance custodian can import statements'; end if;
  if bank_gl(p_account) is null then raise exception 'This account is not linked to the chart of accounts'; end if;
  select coalesce(data->>'currency','TZS') into cur from accounts where id = p_account;
  insert into bank_lines(account_id, date, description, reference, amount, balance, currency, fingerprint, batch, imported_by)
  select p_account, (x->>'date')::date, coalesce(x->>'description',''), nullif(x->>'reference',''), round((x->>'amount')::numeric, 2),
         nullif(x->>'balance','')::numeric, cur,
         md5(concat_ws('|', x->>'date', round((x->>'amount')::numeric,2), lower(btrim(coalesce(x->>'description',''))), coalesce(x->>'reference',''), coalesce(x->>'balance',''), coalesce(x->>'seq',''))),
         b, me
  from jsonb_array_elements(p_rows) x
  where nullif(x->>'date','') is not null and coalesce((x->>'amount')::numeric,0) <> 0
  on conflict (account_id, fingerprint) do nothing;
  get diagnostics n = row_count;
  perform auto_match_statement(p_account);
  return n;
end $$;

-- Book entries on the bank's GL account that no statement line has claimed yet.
create or replace function public.bank_candidates(p_line bigint) returns table(journal_line_id bigint, journal_id text, date date, memo text, amount numeric, days int)
language sql stable security definer set search_path = public as $$
  select jl.id, j.id, j.date, coalesce(jl.description, j.memo), jl.debit - jl.credit, abs(j.date - bl.date)
  from bank_lines bl
  join journal_lines jl on jl.account_code = bank_gl(bl.account_id)
  join journals j on j.id = jl.journal_id and j.status = 'Posted'
  where bl.id = p_line
    and case when bl.currency = 'USD' then round(sign(jl.debit - jl.credit) * coalesce(jl.amount_fc, 0), 2) = round(bl.amount, 2)
             else round(jl.debit - jl.credit, 2) = round(bl.amount, 2) end
    and abs(j.date - bl.date) <= 14
    and not exists (select 1 from bank_lines o where o.journal_line_id = jl.id and o.status in ('Matched','Created'))
  order by abs(j.date - bl.date), j.id
$$;

-- Match automatically where exactly one book entry has the same amount within 7 days.
create or replace function public.auto_match_statement(p_account text) returns int
language plpgsql security definer set search_path = public as $$
declare l record; c record; k int; n int := 0;
begin
  if not keeps_books() and current_email() is not null then raise exception 'Not allowed'; end if;
  for l in select id from bank_lines where account_id = p_account and status = 'Unmatched' order by date, id loop
    select count(*) into k from bank_candidates(l.id) where days <= 7;
    if k = 1 then
      select * into c from bank_candidates(l.id) where days <= 7;
      update bank_lines set status = 'Matched', journal_line_id = c.journal_line_id, matched_by = 'automatic', matched_at = now() where id = l.id;
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;

create or replace function public.match_bank_line(p_line bigint, p_journal_line bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not keeps_books() then raise exception 'Only an administrator or the Finance custodian can match statement lines'; end if;
  if not exists (select 1 from bank_candidates(p_line) where journal_line_id = p_journal_line) then
    raise exception 'That entry does not match this line (amount, account or date), or it is already matched'; end if;
  update bank_lines set status = 'Matched', journal_line_id = p_journal_line, matched_by = current_email(), matched_at = now()
  where id = p_line and status = 'Unmatched';
  if not found then raise exception 'This line is already dealt with'; end if;
end $$;

-- Create the missing book entry from a statement line (bank charges, interest, unexplained receipts) and match it.
create or replace function public.create_from_bank_line(p_line bigint, p_account text, p_description text, p_project text default null) returns text
language plpgsql security definer set search_path = public as $$
declare bl bank_lines; jid text; bank text; rate numeric; base numeric; jl bigint;
begin
  if not keeps_books() then raise exception 'Only an administrator or the Finance custodian can create entries'; end if;
  select * into bl from bank_lines where id = p_line for update;
  if bl.status <> 'Unmatched' then raise exception 'This line is already dealt with'; end if;
  if not exists (select 1 from gl_accounts where code = p_account and active) then raise exception 'Choose an active account'; end if;
  bank := bank_gl(bl.account_id);
  if p_account = bank then raise exception 'Choose the other side of the entry, not the bank itself'; end if;
  rate := case when bl.currency = 'USD' then fx_rate_on(bl.date) else 1 end; base := abs(bl.amount) * rate;
  jid := new_journal(bl.date, coalesce(nullif(p_description,''), bl.description), 'bank', bl.id::text);
  if bl.amount > 0 then
    insert into journal_lines(journal_id, account_code, description, debit, credit, currency, amount_fc, fx_rate, project)
      values (jid, bank, bl.description, round(base,2), 0, bl.currency, abs(bl.amount), rate, p_project) returning id into jl;
    perform add_line(jid, p_account, coalesce(nullif(p_description,''), bl.description), 0, base, bl.currency, abs(bl.amount), rate, p_project, null, null);
  else
    perform add_line(jid, p_account, coalesce(nullif(p_description,''), bl.description), base, 0, bl.currency, abs(bl.amount), rate, p_project, null, null);
    insert into journal_lines(journal_id, account_code, description, debit, credit, currency, amount_fc, fx_rate, project)
      values (jid, bank, bl.description, 0, round(base,2), bl.currency, abs(bl.amount), rate, p_project) returning id into jl;
  end if;
  update bank_lines set status = 'Created', journal_line_id = jl, matched_by = current_email(), matched_at = now(), note = p_description where id = p_line;
  return jid;
end $$;

create or replace function public.ignore_bank_line(p_line bigint, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not keeps_books() then raise exception 'Not allowed'; end if;
  if coalesce(btrim(p_reason),'') = '' then raise exception 'Give a reason'; end if;
  update bank_lines set status = 'Ignored', note = p_reason, matched_by = current_email(), matched_at = now() where id = p_line and status = 'Unmatched';
  if not found then raise exception 'This line is already dealt with'; end if;
end $$;

-- Undo a match or an ignore. A created entry is reversed.
create or replace function public.unmatch_bank_line(p_line bigint) returns void
language plpgsql security definer set search_path = public as $$
declare bl bank_lines; jid text;
begin
  if not keeps_books() then raise exception 'Not allowed'; end if;
  select * into bl from bank_lines where id = p_line for update;
  if bl.status = 'Unmatched' then return; end if;
  if bl.status = 'Created' then
    select journal_id into jid from journal_lines where id = bl.journal_line_id;
    perform reverse_journal_internal(jid, current_date, 'statement line unmatched');
  end if;
  update bank_lines set status = 'Unmatched', journal_line_id = null, matched_by = null, matched_at = null, note = null where id = p_line;
end $$;

alter table public.journals drop constraint journals_source_check;
alter table public.journals add constraint journals_source_check check (source in ('payment','repayment','opening','manual','reversal','invoice','receipt','bank'));

alter table public.bank_lines enable row level security;
create policy read_bank_lines on public.bank_lines for select to authenticated using (sees_books());
grant select on public.bank_lines to authenticated;
revoke all on public.bank_lines from anon;
revoke execute on function public.import_statement(text,jsonb), public.auto_match_statement(text), public.match_bank_line(bigint,bigint),
  public.create_from_bank_line(bigint,text,text,text), public.ignore_bank_line(bigint,text), public.unmatch_bank_line(bigint) from public, anon;
grant execute on function public.import_statement(text,jsonb), public.auto_match_statement(text), public.match_bank_line(bigint,bigint),
  public.create_from_bank_line(bigint,text,text,text), public.ignore_bank_line(bigint,text), public.unmatch_bank_line(bigint),
  public.bank_candidates(bigint), public.bank_gl(text) to authenticated;
create trigger audit_bank_lines after insert or update or delete on public.bank_lines for each row execute function public.audit_row();
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then alter publication supabase_realtime add table public.bank_lines; end if; end $$;

select 'phase 3 ready' as result;
