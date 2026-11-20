-- Fix "No access" after sign-in. Safe to run more than once.
-- Supabase: SQL Editor > New query > paste > Run.

-- 1. Make sure the starting members exist and are active.
insert into public.members (email, full_name, roles, active) values
  ('hamis@tusome.ac.tz',   'Hamis Juma',    '{admin,director,staff}', true),
  ('asnes@tusome.ac.tz',   'Asnes',         '{approver,staff}',       true),
  ('joseph@tusome.ac.tz',  'Joseph Vicent', '{approver,staff}',       true),
  ('finance@tusome.ac.tz', 'Amriya',        '{custodian,staff}',      true)
on conflict (email) do update set active = true, roles = excluded.roles, full_name = excluded.full_name;

-- 2. Let signed-in users reach the tables (row-level security still decides what each person sees and changes).
grant usage on schema public to authenticated;
grant select, insert, update, delete on public.members, public.settings, public.suppliers,
  public.contracts, public.accounts, public.requests to authenticated;
grant select on public.approvals, public.audit_log to authenticated;
grant usage, select on all sequences in schema public to authenticated;
grant execute on function public.current_email(), public.has_role(text), public.is_member(), public.can_write(),
  public.fx_rate_on(date), public.request_band(public.requests), public.chain_complete(public.requests),
  public.decide(text,text,text), public.next_id(text) to authenticated;

-- 3. Check: this should list the members, with active = true.
select email, roles, active from public.members order by email;
