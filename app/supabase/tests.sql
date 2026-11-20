-- Local rule tests: run after 001 and 002 on a test database with Supabase auth simulated (auth.jwt reads request.jwt.claims).
-- Never run against the live database: it creates test requests.
\set QUIET on
create or replace function pg_temp.as_user(e text) returns void language plpgsql as $$ begin perform set_config('request.jwt.claims', json_build_object('email',e,'sub',gen_random_uuid())::text, false); end $$;
create or replace function pg_temp.expect_fail(label text, stmt text) returns text language plpgsql as $$
begin execute stmt; return 'FAIL (no error): '||label; exception when others then return 'ok  '||label||' -> '||sqlerrm; end $$;
create or replace function pg_temp.expect_ok(label text, stmt text) returns text language plpgsql as $$
begin execute stmt; return 'ok  '||label; exception when others then return 'FAIL '||label||' -> '||sqlerrm; end $$;
grant execute on all functions in schema pg_temp to authenticated;
set role authenticated;
select pg_temp.as_user('joseph@tusome.ac.tz');
insert into requests(amount,currency,supplier_id,details) values (1500,'USD','SUP-0004','{"title":"Printing","quotes":[]}');
select id, requester_email, rev, request_band(r) band from requests r where not retro;
select pg_temp.expect_fail('submit with no quotes', $q$update requests set submitted=true where id='PRQ-2026-001'$q$);
select pg_temp.expect_ok('add 3 quotes', $q$update requests set details=details||'{"quotes":[{"a":1},{"a":2},{"a":3}]}' where id='PRQ-2026-001'$q$);
select pg_temp.expect_ok('submit', $q$update requests set submitted=true where id='PRQ-2026-001'$q$);
select pg_temp.expect_fail('change amount after submit', $q$update requests set amount=10 where id='PRQ-2026-001'$q$);
select pg_temp.expect_fail('requester approves own', $q$select decide('PRQ-2026-001','Approved')$q$);
select pg_temp.expect_fail('direct insert into approvals', $q$insert into approvals(request_id,rev,step,decision,by_email) values ('PRQ-2026-001',1,'ID','Approved','x')$q$);
select pg_temp.expect_fail('payment before approval', $q$update requests set details=details||'{"payment":{"trackerId":"Q1","amount":1}}' where id='PRQ-2026-001'$q$);
select pg_temp.as_user('hamis@tusome.ac.tz');
select pg_temp.expect_fail('director approves before step 1', $q$select decide('PRQ-2026-001','Approved')$q$);
select pg_temp.as_user('asnes@tusome.ac.tz');
select pg_temp.expect_fail('reject without reason', $q$select decide('PRQ-2026-001','Rejected','')$q$);
select pg_temp.expect_ok('approver approves step 1', $q$select decide('PRQ-2026-001','Approved','ok')$q$);
select pg_temp.expect_fail('approver approves step 2', $q$select decide('PRQ-2026-001','Approved')$q$);
select pg_temp.as_user('hamis@tusome.ac.tz');
select pg_temp.expect_ok('director approves step 2', $q$select decide('PRQ-2026-001','Approved')$q$);
select pg_temp.expect_fail('decide on complete chain', $q$select decide('PRQ-2026-001','Approved')$q$);
select pg_temp.as_user('finance@tusome.ac.tz');
select pg_temp.expect_ok('custodian records delivery+invoice', $q$update requests set details=details||'{"delivery":{"date":"2026-11-21"},"invoice":{"no":"INV1","amount":1500,"fiscal":"Verified"}}' where id='PRQ-2026-001'$q$);
select pg_temp.expect_fail('payment without tracker ID', $q$update requests set details=details||'{"payment":{"amount":1500}}' where id='PRQ-2026-001'$q$);
select pg_temp.expect_ok('payment with tracker ID', $q$update requests set details=details||'{"payment":{"amount":1500,"trackerId":"Q426-200"}}' where id='PRQ-2026-001'$q$);
select pg_temp.expect_fail('recall a paid request', $q$update requests set submitted=false where id='PRQ-2026-001'$q$);
-- recall flow
select pg_temp.as_user('joseph@tusome.ac.tz');
insert into requests(amount,currency,supplier_id,details) values (100000,'TZS','SUP-0005','{"title":"Fuel","quotes":[{"a":1}]}');
update requests set submitted=true where id='PRQ-2026-002';
select pg_temp.as_user('asnes@tusome.ac.tz'); select decide('PRQ-2026-002','Approved');
select pg_temp.as_user('joseph@tusome.ac.tz');
update requests set submitted=false where id='PRQ-2026-002';
select id, rev, chain_complete(r) complete_after_recall from requests r where id='PRQ-2026-002';
select pg_temp.expect_fail('set rev manually', $q$update requests set rev=9 where id='PRQ-2026-002'$q$);
-- rules / admin
select pg_temp.as_user('joseph@tusome.ac.tz');
with u as (update settings set band1_tzs=1 returning 1) select 'staff settings update rows: '||count(*) from u;
with u as (update members set roles='{admin}' where email='joseph@tusome.ac.tz' returning 1) select 'staff self-promote rows: '||count(*) from u;
select pg_temp.expect_fail('staff edits accounts', $q$insert into accounts(id,data) values ('ACC-99','{}')$q$);
select pg_temp.expect_fail('delete audit', $q$delete from audit_log$q$);
select pg_temp.expect_fail('update audit', $q$update audit_log set actor_email='x'$q$);
select pg_temp.as_user('hamis@tusome.ac.tz');
with u as (update settings set split_days=30 returning 1) select 'admin settings update rows: '||count(*) from u;
select pg_temp.as_user('audit@firm.co.tz');
select 'auditor sees requests: '||count(*) from requests;
select 'auditor sees audit rows: '||count(*) from audit_log;
select pg_temp.expect_fail('auditor creates request', $q$insert into requests(amount,currency) values (1,'TZS')$q$);
select pg_temp.as_user('stranger@gmail.com');
select 'outsider sees requests: '||count(*) from requests;
select pg_temp.as_user('');
select 'anonymous sees requests: '||count(*) from requests;
reset role;
select pg_temp.expect_fail('signup unlisted email', $q$insert into auth.users(email) values ('x@gmail.com')$q$);
select pg_temp.expect_ok('signup listed email', $q$insert into auth.users(email) values ('Asnes@tusome.ac.tz')$q$);
select actor_email, table_name, row_id, action from audit_log where table_name in ('approvals','requests') order by id desc limit 5;
set role authenticated;
select pg_temp.as_user('finance@tusome.ac.tz');
select pg_temp.expect_fail('remove recorded payment', $q$update requests set details=details-'payment' where id='PRQ-2026-001'$q$);
select pg_temp.expect_fail('change recorded payment amount', $q$update requests set details=jsonb_set(details,'{payment,amount}','1') where id='PRQ-2026-001'$q$);
select pg_temp.expect_ok('edit evidence on paid request', $q$update requests set details=details||'{"evidence":"Complete"}' where id='PRQ-2026-001'$q$);
select pg_temp.expect_ok('next supplier id', $q$select next_id('supplier')$q$);
select next_id('supplier');
reset role;
