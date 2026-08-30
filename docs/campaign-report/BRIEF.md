# Campaign Report project — brief

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
  (lint/type-check/tests/build) pass locally.
- **Blocked on Peter**: run `scripts/create_campaign_reports_table.sql` (and
  the `campaign_reports` section of `supabase/rls-policies.sql`) in the
  Supabase SQL Editor, then approve running `import_campaign_reports.ts
  --apply` against production.
- **Not started**: phase 2 (incremental catch-up dump — script already
  supports this, just needs a fresh export from Jordan when the time comes)
  and phase 3 (the in-app replacement screen).
