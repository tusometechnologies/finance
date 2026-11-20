# TUSOME Finance & Procurement — finance.tusome.ac.tz

Purchase requests, approval chains, suppliers, contracts, bank & wallets, exceptions and an audit trail.
Staff sign in with their **email (username) and password**. What each person can do comes from their **role**.

- Hosting: Vercel (static site + two small server functions in `api/`)
- Database and logins: Supabase (Postgres + Supabase Auth)
- Every rule is enforced in the database (`supabase/001_schema.sql`), not in the browser.

## Database updates (run in order in Supabase > SQL Editor)
1. `supabase/001_schema.sql` — tables, approval rules, audit trail
2. `supabase/002_seed.sql` — members, settings, suppliers, accounts
3. `supabase/003_fix_access.sql` — access grants (safe to re-run)
4. `supabase/004_expenses_envelopes_bank.sql` — envelopes, expense claims, who we owe, bank reconciliation,
   and opening balances owed to staff (from the tracker's Outstanding Reimbursements; verify before paying)
5. `supabase/005_payments_ledger.sql` — the platform becomes the book of payments: payments ledger (company and personal
   money), part-repayments, pre-approved envelopes, alternate approver (habari@) for the Director's own items,
   November 2026 tracker payments imported. Earlier months: Payments > Import from tracker (CSV).
6. `supabase/006_import_tracker_oct_nov.sql` — all 135 tracker payments from October 2026 onwards (Oct 78, Nov 57),
   read from the tracker file on 20 Nov 2026, all treated as approved. Totals match the tracker's monthly summaries.

## Roles

| Role | Can do |
|---|---|
| staff | Raise and edit requests, suppliers, contracts; record delivery, invoice, payment |
| approver | Approve or reject the first step (Band 1–2 approver / Independent Director) |
| director | Approve or reject the second step for Band 3 (above USD 1,000) |
| custodian | Finance custodian (records payments; label for reporting) |
| admin | Change rules, FX and tax rates, bank & wallets, people and passwords |
| auditor | Read everything, including the audit trail; change nothing |

Expense claims: anyone logs their own; a Band 1–2 approver or the Director approves (Director above USD 1,000);
nobody approves their own. Staff see only their own claims. The Finance custodian or an admin records reimbursements
(never their own) against the tracker Record ID. Envelopes: admin only. Bank reconciliations: prepared by the
custodian or an admin, signed off by a different admin; a difference must be explained first.

Starting members (`supabase/002_seed.sql`): habari@ (admin), hamis@ (admin, director), asnes@ and joseph@ (approver),
finance@ (custodian). Nobody can approve their own request.

## Easiest setup: Supabase through Vercel (about 20 minutes)
1. Vercel → Add New → Project → import `tusometechnologies/finance`, Root Directory `app`, Framework `Other` → Deploy.
2. In that project: **Storage** tab → Create Database → **Supabase** → choose a region → Connect to this project.
   Vercel creates the Supabase project and adds the keys as environment variables automatically
   (the app accepts both `SUPABASE_*` and `NEXT_PUBLIC_SUPABASE_*` names).
3. Storage tab → your Supabase database → **Open in Supabase**. There: SQL Editor → run `supabase/001_schema.sql`,
   then `supabase/002_seed.sql`. Then Authentication → turn **Allow new users to sign up** OFF; URL Configuration →
   Site URL `https://finance.tusome.ac.tz`; Users → Add user → your email + password, tick Auto Confirm.
4. Back in Vercel: Deployments → Redeploy (so the new variables load). Settings → Domains → add `finance.tusome.ac.tz`
   and create the DNS record shown.
5. Sign in, open People & logins, and set a password for each person.

## Manual setup (alternative)

### 1. Supabase
1. Create a project at supabase.com (choose the region closest to Tanzania, e.g. EU Frankfurt or South Africa).
2. SQL Editor → New query → paste `supabase/001_schema.sql` → Run. Then do the same with `supabase/002_seed.sql`.
3. Authentication → Sign In / Providers → Email: keep **Email** enabled, turn **Allow new users to sign up** OFF.
4. Authentication → URL Configuration: Site URL `https://finance.tusome.ac.tz`; add it to Redirect URLs.
5. Authentication → Policies (or Passwords): minimum length 10.
6. Project Settings → API: copy the **Project URL**, the **anon public** key and the **service_role** key.

### 2. Vercel
1. New Project → import the `tusometechnologies/finance` repository → Root Directory: `app` → Framework: Other.
2. Environment Variables:
   - `SUPABASE_URL` = Project URL
   - `SUPABASE_ANON_KEY` = anon public key
   - `SUPABASE_SERVICE_ROLE_KEY` = service_role key (**secret**; never put it in code or share it)
3. Deploy. Then Settings → Domains → add `finance.tusome.ac.tz` and create the DNS record Vercel shows
   (a CNAME for `finance` at your DNS host for tusome.ac.tz).

### 3. First login
The first administrator needs a password before the app can create others. In Supabase:
Authentication → Users → Add user → `habari@tusome.ac.tz` (or `hamis@tusome.ac.tz`), set a password, tick
**Auto Confirm User**. Sign in at finance.tusome.ac.tz → **People & logins** → **Set password** for each person.
Give each password to the person directly (not by email or chat). They can change it under **Password**.

Only emails listed in People & logins can ever get a login; the database refuses any other.

## How the main rules are enforced (database)
- Band from amount and the BoT FX rate in force on the request date; Band 3 above USD 1,000.
- Submitting needs a supplier and the number of quotations for the band (or a waiver reason), from the policy start date.
- After submission the amount, supplier, date and quotations are locked; changing them needs "Recall to draft",
  which starts a new revision so earlier approvals stop counting.
- Approvals only through `decide()`: right role, right order, not the requester, reason required to reject.
- Delivery, invoice and payment only after full approval; a payment needs the expenditure tracker Record ID,
  and once recorded it cannot be removed or changed.
- Rules, FX rates, people and bank & wallets: admin only.
- Audit trail written by database triggers on every change; nobody can edit or delete it.

## Files
- `public/index.html`, `public/app.js` — the app
- `api/config.js` — gives the browser the public Supabase URL and anon key
- `api/admin-users.js` — create a login or set a password (admins only; uses the service-role key on the server)
- `supabase/001_schema.sql` — tables, rules, functions, row-level security, audit triggers
- `supabase/002_seed.sql` — settings, members, 15 suppliers, 8 accounts, 2 retrospective requests

## Tested
The database rules were run against PostgreSQL 16 with Supabase's auth functions simulated: 30 checks covering
self-approval, step order, role checks, payment before approval, tracker ID, payment immutability, revisions,
admin-only settings and people, audit immutability, auditor read-only, outsider and anonymous access, and
blocked sign-up for unlisted emails. The screens were rendered with sample data at desktop and phone width.
Not yet tested against a live Supabase project or Vercel.
