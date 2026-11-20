# TUSOME Finance & Procurement Control Register

Design record for the Google Sheet "TUSOME Finance & Procurement Control Register" (Phase 1, set up 2026-11-20).
The sheet lives in the TUSOME company Google account, folder "TUSOME Finance Controls".

## Purpose

The register holds the procurement controls behind each purchase (FIN-02): request, quotations, approval,
contract, delivery, invoice, fiscal receipt and evidence. It does **not** hold transactions. The expenditure
tracker (`TUSOME expenditure tracker - Q4 2026 onwards.xlsm`) stays the only book of payments (FIN-01).
The two are linked by the tracker Record ID (e.g. `Q426-099`) entered in the register.

The tracker is an `.xlsm` file, so Google Sheets cannot read it with live formulas. The check
"tracker payments above TZS 500,000 with no Procurement ID" is therefore a monthly manual check.

## Tabs (Phase 1)

| Tab | Holds | Policy | Edit rights |
|---|---|---|---|
| README | How to use the register | - | Owner/Director |
| Procurement Log | One row per purchase request (PRQ); band, quotes required, approval route and checks are calculated | FIN-02, GOV-01 | TUSOME users (calculated columns locked) |
| Supplier Register | F07 verification; status is calculated from the evidence fields | FIN-02 | TUSOME users (status locked) |
| Contract Register | Contracts, ToR, IP, SAF-01, DATA-02; invoiced-to-date pulled from the Procurement Log | FIN-02, FIN-06 | TUSOME users (calculated columns locked) |
| Exceptions | Live counts and list of control gaps | FIN-02 | Locked (formulas) |
| FX & Thresholds | Approval FX rate table, bands, split window, roles, WHT rates | FIN-01, FIN-02, GOV-01 | Director only |
| Bank & Wallet Register | Accounts, wallets, gateways, signatories; last 4 digits only | FIN-01 | Director only |
| Change Log | Audit trail written by `AuditLog.gs` | Audit | Locked (script) |
| Lists | Dropdown values | - | Director only |

Phase 2 (not built): Recurring Services Register, Supplier Advances, Budget Envelopes.

## Rules implemented (values from the prototype; all marked "To confirm")

- Band 1: below TZS 500,000, 1 quote, Independent Director approval.
- Band 2: TZS 500,000 to USD 1,000, 2 quotes, Independent Director approval.
- Band 3: above USD 1,000, 3 quotes, Independent Director then Director approval.
- USD conversion uses the latest approval FX rate on or before the request's FX date (default: date raised).
  The current rate (TZS 2,500/USD) is a placeholder.
- Possible split: same supplier, requests within +/- 30 days, combined value falls in a higher band than the request alone.
- Purchases dated before the policy effective date (2026-11-04) show "Pre-policy" for quotations.
- Supplier is "Verified" only when TIN, EFD/VFD status, call-back verification, verifier, conflict declaration and F07 link are complete.

## ID formats

`PRQ-2026-001` (retrospective: `PRQ-2026-R001`), `SUP-0001`, `CON-2026-001`, `ACC-01`.

## Access model

- Users: named TUSOME email addresses only, added individually. No link sharing. Editors cannot re-share.
- Auditor: one named account with **Viewer** access. Viewers cannot open version history, so the
  `Change Log` tab, written by `AuditLog.gs`, is the auditor's trail.
- Director-only tabs are enforced with protected ranges. Add the Director's TUSOME email as an editor of each protected range.
- Viewers and commenters cannot download, print or copy.

Limitation: the file is owned by a consumer Gmail account. Google only records the editor's email for
users in the same Workspace domain, so some Change Log rows may read "Not identified"; use version history
(owner/editors) to resolve them. Domain-only access cannot be enforced technically on a consumer account;
it is a sharing rule. Moving ownership to a `tusome.ac.tz` Google Workspace account fixes both.

## Back-filled data

- 15 suppliers from tracker payees (prototype snapshot), all "Not verified".
- 8 accounts in the Bank & Wallet Register, including 3 personal accounts used for company payments.
- 2 retrospective procurement rows: Judith Severini John, TZS 335,000 on 2026-11-05 (Q426-099) and
  2026-11-06 (Q426-107), same description, different evidence files. Flagged as possible split or duplicate.
