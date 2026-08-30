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

## Open questions — blocking phase 1

- **Real column layout.** Haven't seen the actual sheet/export yet. Need it
  (or a fresh one) before designing the target schema or writing an import
  script.
- **Data granularity.** The closeout note describes "aggregate per-campaign
  tallies" (counts), which doesn't fit the existing `results` table's
  per-person model (`first_name` + `category_code` per row, see
  `CLAUDE.md`'s Database tables section). Likely needs its own table —
  tentatively `campaign_reports` — rather than reusing `results`. To be
  confirmed once the real columns are seen.
- **Link to `campaigns`.** Does each row correspond to an existing row in
  the `campaigns` table (matchable by date+state+place), or does historical
  data predate/not-track cleanly against it? Determines whether we store a
  `campaign_id` FK, a denormalized date/state/place, or both.
- **De-dup key for the catch-up dump.** What uniquely identifies a
  submission (a sheet-native timestamp/row id? campaign + date + place +
  submitter?) so re-importing an overlapping export doesn't double-count.
- **Submitter identity.** Does the sheet capture who submitted the report,
  and if so does that map onto an existing `state_leaders` row?

## Status

Not started beyond this brief — no schema, no migration script, no UI.
Next step: Peter to provide Jordan's spreadsheet (or a fresh export) so the
above can be answered and phase 1 designed.
