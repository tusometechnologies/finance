# TUSOME Finance & Procurement platform

Live web platform published as a claude.ai artifact: https://claude.ai/artifact/13STx3H3Z2QyTRDhbpV1b9
`tusome-finance.html` is the published source. Republish from this file to keep the same URL.

## What it does
- Purchase requests with status tabs: Draft, Awaiting approval, Approved, Awaiting payment, Paid, Rejected.
- Approval chain from FIN-02 / GOV-01: Band 1-2 Independent Director; Band 3 Independent Director then Director.
  Nobody approves their own request. A decision only counts if made by the person holding that role.
  Recalling or revising a request starts a new revision; earlier approvals no longer apply.
- Delivery (F08), invoice with fiscal-receipt status, payment linked to the expenditure tracker Record ID.
- Suppliers (F07 verification), contracts (ToR, IP, SAF-01, DATA-02 checks), bank & wallets, exceptions, audit trail.
- Rules & roles: FX rates (BoT), bands, split window, WHT rates (TRA 2025/26), approver assignment.

## Roles (set 2026-11-20)
Roles are assigned by email and matched to the claude.ai account email:
- Director (Band 3, above USD 1,000): hamis@tusome.ac.tz
- Band 1-2 approver (either): asnes@tusome.ac.tz, joseph@tusome.ac.tz
- Finance custodian: finance@tusome.ac.tz (Amriya)

The platform is the live procurement register from 2026-11-20. The Google Sheet control register is the archive.

## Hosting
Capabilities (database, sign-in) only run inside claude.ai. A custom domain such as finance.tusome.ac.tz can
redirect to the artifact URL; a standalone deployment would need its own backend and login.

## Data and access
Database rules (enforced by the platform, not the page):
| Path | Read | Write |
|---|---|---|
| requests, suppliers, contracts, counters | Viewer and up | Contributor and up |
| config (rules, FX, roles), accounts | Viewer and up | Editor (Director) and owner |
| approvals/<person> | Viewer and up | only that person |
| audit/<person> | Viewer and up | only that person |

Share-menu levels: Director = Editor; staff = Contributor; auditor = Viewer. Keep the artifact shared
inside the TUSOME organization only, with no public link. Accounts outside @tusome.ac.tz see a read-only UI.

Seeded 2026-11-20 from the Google Sheet control register: settings, 15 suppliers, 8 accounts, 2 retrospective requests.

## Known limits
- Each person can delete their own audit entries (nobody else can). Pair with periodic exports.
- The @tusome.ac.tz check is in the page; the real boundary is the artifact's sharing settings.
- The expenditure tracker (.xlsm) is not linked live; payments carry its Record ID.
- Database cap: 25,000 documents per artifact.
