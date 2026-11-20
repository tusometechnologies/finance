-- Hamis confirmed (20 Nov 2026) that he paid the October payments funded from Founders' capital
-- where the tracker named no payer. Safe to run more than once.
update public.payments
set notes = replace(notes,
  ' Payer not named in the tracker (marked ''requires clarification''); funded from Founders'' capital, so recorded as Founders wallet (Hamis). Confirm.',
  ' Paid by Hamis from the Founders wallet (confirmed 20 Nov 2026).')
where imported and notes like '%requires clarification''); funded from Founders%';

-- Check: expect 0
select count(*) as still_unconfirmed from public.payments where imported and notes like '%Confirm.%';
