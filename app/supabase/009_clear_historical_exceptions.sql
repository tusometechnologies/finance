-- Clear exceptions raised by records from before the platform started.
-- The two retrospective requests (Judith Severini John, Q426-099 and Q426-107) are already in the payments ledger
-- from the tracker import and are treated as approved, like all October-November records. Safe to run more than once.
update public.requests
set details = details || jsonb_build_object('historical', true, 'evidence', 'Complete')
where retro and coalesce((details->>'historical')::boolean, false) = false;

-- Check: expect 2
select id, details->>'historical' as historical from public.requests where retro;
