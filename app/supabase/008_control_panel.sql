-- The alternate approver (habari@) decides only the Director's own payments above the USD threshold.
-- Payments up to the threshold: a Band 1-2 approver or the Director. Safe to run more than once.
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
  elsif not has_any_role(array['approver','director']) then
    raise exception 'Only a Band 1-2 approver or the Director can decide payments up to USD %', thr;
  end if;
  perform set_config('tusome.fn', '1', true);
  update payments set status = p_decision, decided_by = me, decided_at = now(), decision_comment = coalesce(p_comment,''),
    approval_basis = 'Decision by ' || me where id = p_id;
  perform set_config('tusome.fn', '', true);
end $$;
select 'decide_payment updated' as result;
