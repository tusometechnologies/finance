-- Judith Severini John: Q426-099 and Q426-107 are two separate payments of TZS 335,000, both approved.
-- Replaces the earlier "possible duplicate or split purchase" wording. Safe to run more than once.
update public.requests
set details = details || jsonb_build_object('notes',
  'Retrospective entry from the expenditure tracker. Two separate payments to Judith Severini John (Q426-099 and Q426-107), '
  || 'confirmed 20 Nov 2026 as separate purchases, not a duplicate or split. Approved like all October-November records.',
  'historical', true, 'evidence', 'Complete')
where id in ('PRQ-2026-R001','PRQ-2026-R002');

update public.payments
set status = 'Approved',
    notes = coalesce(notes, '') || ' Confirmed 20 Nov 2026: a separate payment, not a duplicate or split; approved.'
where tracker_id in ('Q426-099','Q426-107') and coalesce(notes,'') not like '%Confirmed 20 Nov 2026: a separate payment%';

update public.suppliers
set data = data || jsonb_build_object('notes',
  'Paid Q426-075, Q426-099 and Q426-107 (the last two TZS 335,000 each, confirmed separate payments). First used: Q426-075.')
where id = 'SUP-0001';

-- Check
select tracker_id, status, amount from public.payments where tracker_id in ('Q426-099','Q426-107') order by tracker_id;
