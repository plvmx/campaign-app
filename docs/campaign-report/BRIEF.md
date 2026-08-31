# Campaign Report project — brief

## ⚠️ ON HOLD (2026-09-01)

New information has come to light suggesting this project may not be
required anymore. Phase 1 (initial load + the date-plausibility bug fix,
below) is complete and correct as it stands — the `campaign_reports` table
holds a fully-loaded, verified-accurate snapshot of the historical data.
**Phases 2 (incremental catch-up dump) and 3 (in-app replacement screen)
are paused and were never started.** Nothing further should be built here
without checking in first. If the project is confirmed dead, decommission
is a small job (drop the table, remove it from `CLAUDE.md` and
`BACKUP_TABLE_CONFIG`) — not done yet, since "may not be required" isn't
"confirmed cancelled."

## Goal

Give AFJ's "Campaign Report" data a proper structured home in this app, and
eventually retire the external Google Sheets / `www.australiaforjesus/campaignreport`
form entirely.

"Campaign Report" is the aggregate per-campaign tally leaders submit after
running a campaign — partial presentations, full presentations, sinner's
prayer, information requests. It has been going into a Google Sheet
maintained by Jordan the whole time; it is **not** ActiveCampaign data.

## Background

This surfaced as a side investigation during the registry pipeline project
(`feat/registry-pipeline`, unmerged as of 2026-08-30). It was initially
suspected to be AC-native data (an AC form or list), but was ruled out
definitively — see that branch's `docs/registry-pipeline/OPERATIONS.md`,
"Investigated and closed: Campaign Report data is not in AC (2026-08-30)".
Peter then confirmed from earlier correspondence with Jordan that
submissions have actually always landed in a Google Sheet
(`AFJ Tracking Export 20260827.xlsx`, "campaign report" tab).

Out of scope for the registry pipeline (no `registry.*` involvement) —
split into this separate project/branch per that closeout note.

## Phases (as directed by Peter, 2026-08-30)

1. **Initial load** — one-time import of Jordan's spreadsheet (historical
   data to date) into a new, permanent table in this app's Supabase project.
2. **Incremental catch-up dump** — once Jordan provides a fresh export
   covering the gap between the initial load's cutoff and go-live, load
   just the delta without duplicating rows already loaded.
3. **Replacement screen** — an in-app screen for leaders to submit Campaign
   Report data directly, replacing the external Google Form so AFJ can be
   switched off Google Sheets for this data entirely.

## Phase 1 findings (2026-08-30/31)

Inspected the real file: `AFJ Tracking Export 20260827.xlsx` (the "SS Export"
sibling in the same folder is an older, corrupt-data copy — don't use it),
"campaign report" sheet, 6,203 data rows spanning Sept 2021 – Aug 2026:

| Date (submission) | Location | Campaign Leader | Dates (campaign date) | Partial | Full | Sinners Prayer | Information Requests |
|---|---|---|---|---|---|---|---|

Answers to the open questions above, confirmed by Peter (2026-08-30):

- **Data granularity**: confirmed aggregate per-submission tallies, not
  per-person — a standalone `campaign_reports` table
  (`scripts/create_campaign_reports_table.sql`), not a reuse of `results`.
- **Link to `campaigns`**: not attempted in phase 1. `Location` (1,355
  distinct raw strings) and `Campaign Leader` (1,693 distinct raw strings)
  are free text — typos, inconsistent state suffixes, "+2" annotations —
  nowhere near clean enough for a reliable join. `campaign_reports.campaign_id`
  exists as a nullable, unenforced FK for a future matching/cleanup pass.
- **De-dup key**: the sheet's own "Date" column (Google Form submission
  timestamp) is unique across all 6,203 rows with zero nulls — clean natural
  key, enforced as `campaign_reports.submitted_at UNIQUE`. The import script
  upserts on it with `ignoreDuplicates: true`, so the same script handles
  both the initial load and any later catch-up dump safely.
- **Submitter identity**: not captured distinctly from `Campaign Leader`
  (free text, not an auth identity) — no link to `state_leaders` in phase 1.

Two further data-quality issues, and how the import handles them (both
confirmed by Peter, 2026-08-30):

- **Non-numeric tallies**: leaders sometimes typed a note instead of a
  number (69/56/114/624 rows respectively for Partial/Full/Sinners
  Prayer/Information Requests) — from `"10(1 with 5 persons...)"` to full
  narratives. `lib/campaignReportParser.ts`'s `parseTallyValue()` extracts a
  leading number where present, maps known zero-words (`Nil`/`None`/`—`/the
  letter `O`) to 0, and otherwise leaves the parsed value `null` — the
  original text is always preserved in a paired `*_raw` column, never
  discarded.
- **Unparseable campaign dates**: ~25% of rows (1,553) aren't a native Excel
  date — mostly a human-typed string in a wide variety of formats (`"18th
  September 2021"`, `"6.4.24"`, `"2024.04.06"`, `"August 7th"`, multi-date
  entries like `"9/9/21 & 10/9/21"`), occasionally a digit string with a
  dropped leading zero (`"50222"` for `"050222"`). `parseCampaignDate()`
  recovers the well-populated patterns (weekday/ordinal/"of"/AM-PM
  stripping, dot- and slash-separated numeric, day-or-month-first month-name
  text, multi-date splitting, year inference from the submission date with a
  Dec/Jan rollback, and unambiguous 8-digit `YYYYMMDD` typed as a plain
  number) — recovering 1,412 of the 1,553 (91%). What's left genuinely
  unparseable is left `null` with the original text kept in
  `campaign_date_raw` and `needs_review = true`, per Peter's "keep + flag"
  decision, rather than guessed.

Net result of a dry run against the real file: all 6,203 rows load (0
skipped — every row has a usable `submitted_at`); 416 rows (6.7%) are
flagged `needs_review`, almost all because the Information Requests column
held a narrative note rather than a count.

## Status

- **Done**: schema (`scripts/create_campaign_reports_table.sql`), RLS
  (`supabase/rls-policies.sql`, admin-only for now), parsing logic +
  unit tests (`lib/campaignReportParser.ts`,
  `lib/__tests__/campaignReportParser.test.ts`), extraction + import scripts
  (`scripts/campaign_reports_xlsx_to_json.py`,
  `scripts/import_campaign_reports.ts`), backup config
  (`lib/services/backupService.ts`, format version bumped to `5`). Dry-run
  verified end-to-end against the real spreadsheet. All four CI checks
  (lint/type-check/tests/build) pass locally. PR #168.
- **Done, applied to production (2026-08-31)**: `create_campaign_reports_table.sql`
  and the `campaign_reports` section of `rls-policies.sql` have been run in
  the Supabase SQL Editor — the empty table exists live (verified: 0 rows).
- **Done, initial load complete (2026-09-01)**: `import_campaign_reports.ts --apply`
  run by Peter directly (this session's own Bash was blocked from running a
  production write by the local permission classifier — expected, not a
  bug). All 6,203 rows loaded, 0 duplicates, 416 (6.7%) flagged
  `needs_review`, independently re-verified against the live table
  (submitted_at range 2021-09-02 → 2026-08-26, matching the source sheet).
  Phase 1 is complete.
- **Not started, on hold**: phase 2 (incremental catch-up dump) and phase 3
  (the in-app replacement screen) — see the ON HOLD note at the top of this
  file. Don't start either without checking in first.

## Bug found in production (2026-09-01): implausible dates not flagged

Peter spotted `campaign_date` values from 2035 and 2027 in the loaded data.
Root cause: `parseCampaignDate()`'s only submission-date sanity check
(`resolveYearlessDate`'s "more than 45 days future → try last year" logic)
applied solely to dates with no year given. A date that already carried an
**explicit but mistyped** year — a leader's typo, or a fat-fingered year on
a native Excel date-picker cell — sailed straight through untouched. Real
examples: `"14.6.35"` submitted 2025-06-13 (meant `14.6.25`), a native date
cell of 2027-08-08 submitted 2026-08-07, `"27th Feb 2028"` submitted
2025-02-26, a native date cell of 2020-06-26 submitted 2026-06-27 (~6 years
off).

Querying the full loaded table found the true shape of the problem: 47 rows
more than 45 days *after* their own submission (up to 4,018 days — 11
years), and 51 rows more than 270 days *before* it (down to -2,192 days).
Critically, the near-year-exactly-late rows (-365 to -368 days, ~32 of the
51) turned out to be **genuine, correct** dates — several leaders had
batch-submitted a full year of backlogged reports at once (e.g. multiple
"Sunshine" rows, each with a distinct, correct 2024 date, all submitted
together in mid-2025). Only the rows further back than that — multi-year
jumps — were actual errors. This is why the fix uses an **asymmetric**
window rather than a single tolerance: `MAX_FUTURE_DAYS = 45` (a report can
never legitimately describe a campaign that hasn't happened) and
`MAX_PAST_DAYS = 400` (comfortably past the genuine ~365-368-day backlog
cluster, safely short of the multi-year error outliers).

**Fix**: `lib/campaignReportParser.ts`'s `parseCampaignDate()` now runs
*every* successfully parsed date — regardless of source (native Date,
8-digit number, or any text pattern, with or without an explicit year) —
through `isPlausibleRelativeToSubmission()` before accepting it. A date
outside the window is rejected the same way any other unparseable date is:
`campaign_date = null`, original value preserved in `campaign_date_raw`,
`needs_review = true` — never auto-corrected, since guessing which year a
leader *meant* isn't something this parser should do. 6 regression tests in
`lib/__tests__/campaignReportParser.test.ts` reproduce the exact production
rows (proven red against the pre-fix parser, green after).

Because the fix only *adds* a rejection gate — it never changes how an
accepted date's value is computed — its only possible effect on any given
row is a flip from `(some date, needs_review: false)` to
`(null, needs_review: true)`. Re-running the full sheet through the fixed
parser confirms exactly that: `needs_review` count goes from 416 to 467 (+51,
matching the count above), with every other field byte-for-byte unchanged.

**Reconciliation**: since the initial load already ran with the buggy
parser, fixing the code doesn't fix the 6,203 already-loaded rows.
`scripts/reconcile_campaign_report_dates.ts` re-normalizes every sheet row
with the fixed parser, compares `campaign_date`/`campaign_date_raw`/
`needs_review` against what's live (matched on the `submitted_at` unique
key), and updates only the 51 rows that differ — dry-run by default,
`--apply` to write, same conventions as the import script. Dry run against
production confirms exactly 51 updates, all in the expected direction
(date → null, false → true), 0 unmatched rows.

**Applied (2026-09-01)**: Peter ran `reconcile_campaign_report_dates.ts --apply`.
Independently re-verified live: `needs_review` count is 467 (matches),
zero rows have a `campaign_date` past 2026-12-31, and the specific `"14.6.35"`
row correctly reads `campaign_date: null, needs_review: true`. PR
[#169](https://github.com/plvmx/campaign-app/pull/169) merged to `main`.
