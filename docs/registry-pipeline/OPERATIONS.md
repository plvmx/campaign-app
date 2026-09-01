# Registry Pipeline — Operations Guide

Companion to [BRIEF.md](./BRIEF.md) and
[AFJ_PII_Technical_Implementation_Plan.md](./AFJ_PII_Technical_Implementation_Plan.md).
Those two documents are the design; this one is the "how do I actually run
this" checklist, since the registry pipeline is the first part of this repo
to use Supabase Edge Functions / the Supabase CLI / pg_cron — everything
else in the app is plain Next.js + Vercel Cron.

## One-time setup

1. **Install the Supabase CLI** (`brew install supabase/tap/supabase` or see
   [supabase.com/docs/guides/cli](https://supabase.com/docs/guides/cli)).
2. **Link the project:** `supabase link --project-ref <ref>` — this writes
   to `.supabase/` (gitignored), not `supabase/config.toml`.
3. **Run the schema migrations** (Supabase SQL Editor, in order):
   - `scripts/create_registry_pipeline_schema.sql`
   - `scripts/create_registry_leader_roles_table.sql`
4. **Expose the `staging` and `registry` schemas to PostgREST** — Dashboard
   -> Project Settings -> Data API -> "Exposed schemas" -> add `staging`
   and `registry` alongside the existing `public`. `db.ts`'s
   `client.schema('registry')...` calls go through PostgREST like every
   other supabase-js call (even with the service role key) — without this
   step every query in the Edge Function fails with "schema must be one of
   the following: ...". This is a project-level setting, not something a
   SQL script can do.
5. **Enable the Email OTP (magic link) provider** — Dashboard ->
   Authentication -> Providers -> Email -> enable "Email OTP" / disable
   password sign-in for this flow if leaders should never set a password.
6. **Enable MFA** — Dashboard -> Authentication -> Multi-Factor
   Authentication -> enable TOTP (and/or Phone) as an available factor.
   This makes MFA *available*; `registry.leader_roles.mfa_required` (set
   automatically for `national_admin`/`whatsapp_admin` by a trigger — see
   `create_registry_leader_roles_table.sql`) plus `registry.has_required_mfa()`
   is what actually *enforces* it once a leader-facing read path exists
   (the RLS view / export RPC in plan Section 7.2/7.3, both still blocked —
   see BRIEF.md's out-of-scope list). Until then, enforcement is in place at
   the database level but has nothing yet to gate.
7. **Deploy the function:** `supabase functions deploy ac-sync`
8. **Set its secrets** (never in a script, never committed):
   ```bash
   supabase secrets set AC_API_BASE_URL=https://<account>.api-us1.com/api/3
   supabase secrets set AC_API_KEY=<the shared, non-rotatable AC key>
   ```
9. **Store a bearer token for pg_net** in Supabase Vault, then run
   `scripts/schedule_ac_sync_cron.sql` (see that file's header for the exact
   steps and prerequisites).

## Manual invocation (do this before scheduling)

Per the brief's build order, test the function manually before turning the
cron job on:

```bash
supabase functions invoke ac-sync --no-verify-jwt
```

(`--no-verify-jwt` only for a local/manual test call if verifying JWT is
inconvenient in your CLI version; the deployed function still has
`verify_jwt = true` per `supabase/config.toml`, matching how the scheduled
call authenticates in `scripts/schedule_ac_sync_cron.sql`.)

Check the result:

```sql
select * from registry.sync_log order by started_at desc limit 5;
select count(*) from staging.ac_events;
select count(*) from registry.registrants;
```

**Before the first real run**, verify the exact AC API v3 endpoint shapes
this function assumes — see the header comment in
`supabase/functions/ac-sync/acClient.ts`. This implementation was written
against AC's documented, stable v3 endpoints without a live test call in
this session (no AC credentials were available). If any field/response
shape differs from what's assumed there, that file is the only one that
should need to change — the transform/mapping logic in
`lib/registryPipeline/` doesn't know or care how the data was fetched.

## Architecture at a glance

```
supabase/functions/ac-sync/     Deno Edge Function — thin adapters only
  acClient.ts                     AcPort implementation (fetch against AC API v3)
  db.ts                           DbPort implementation (supabase-js, service role)
  index.ts                        Deno.serve entrypoint — wires the two together, calls runSync()

lib/registryPipeline/           Framework-agnostic orchestration + business logic
  types.ts                        Shared data shapes
  ports.ts                        AcPort / DbPort interfaces (the seam between the two above)
  sync.ts                         runSync() — Section 6.1
  transform.ts                    transformPendingStagingEvents() — Section 6.2
  fieldMap.ts                     Field-inclusion whitelist (Section 3.4)
  phone.ts                        E.164 normalization (Section 6.2)
  sourceAttribution.ts            Tag-based source matching (Section 3.3)
  listFilter.ts                   List 3/5 exclusion + list-status check (Section 3.6/6.1/6.2)
  rateLimiter.ts                  429 backoff + request pacing (Section 3.2/6.1)
  __tests__/                      Vitest coverage for everything above (Node-safe; no Deno/Supabase dependency)
```

All the actual decision logic lives in `lib/registryPipeline/` and is unit
tested under Vitest like the rest of this app's `lib/`. `supabase/functions/`
is deliberately excluded from the root `tsconfig.json` (Deno globals and
`npm:`/`.ts`-extension imports aren't valid under the Next.js Node
toolchain) — there is currently no separate CI type-check for that
directory; `deno check` locally before deploying is a manual step, not
enforced by this repo's four CI jobs.

## Retention (open question, not yet implemented)

Plan Section 10 flags `staging.ac_events` retention as an open decision
(e.g. purge processed rows after 30 days). Not built in this session —
revisit once real data volume is known.

## Incident: List 3/5 contamination (2026-08-28)

AC's `/contactLists` list filter (`acClient.ts`) did not actually filter —
confirmed via reconciliation against a real ground-truth spreadsheet.
Every List 1/2 query returned an unfiltered mix of every list, including
Lists 3 (Business Life) and 5 (Tony Mclennan), which are supposed to be
permanently excluded (plan Section 3.6) — List 5 specifically because it
carries sensitive financial-intent data. 347 rows landed in
`staging.ac_events` with the wrong list; 114 reached
`registry.registration_events` before this was caught.

Fixed in `lib/registryPipeline/sync.ts`/`acClient.ts` (see that file's
"Fourth deliberate deviation" comment) — corrected AC's filter parameter,
plus an application-level check that discards any returned row whose list
doesn't match what was actually requested, regardless of what AC's own
filter does. `scripts/cleanup_list3_5_contamination.sql` removes the
already-landed contamination from `registry.*` (staging rows are marked
excluded, not deleted, since `staging.ac_events` is meant to stay an
append-only audit trail).

**Before trusting this pipeline for ongoing sync**, redo the reconciliation
against the ground-truth spreadsheets split by list (File2's "main AFJ
page" sheet for List 1, "Responders at 1 Nov 2025" for List 2 — note the
latter is stale, so expect genuine new List-2 registrations beyond it) —
the first reconciliation pass was run before this bug was found and isn't
trustworthy on its own.

## Decision: Postcode field mapping added (2026-08-29)

Reverses the original plan Section 3.4/3.5 exclusion. That exclusion was
because postcode never reached AC at all (a landing-page bug, not a
pipeline decision) — confirmed fixed upstream and live-tested by Peter
(two real test registrations landed real postcode values). AC custom field
`[30] Post Code` was created 2026-08-26 — brand new. Implemented in
`fieldMap.ts`/`types.ts`/`ports.ts`/`db.ts`, plus
`scripts/add_postcode_to_registrants.sql` for the new column.

**Historical registrants will NOT be retroactively backfilled with
postcode by AC** — `registrants.postcode IS NULL` is expected and normal
for anyone registered before ~2026-08-26, not a data-quality problem.

**Follow-up, not yet built:** Lorraine's manually-compiled spreadsheet has
postcode for many more historical registrants than AC ever will (she
collected it some other way over the years) and she's providing a more
complete "final" version in the next few days. Once that lands, this needs
a one-off import (matched by email, only filling `postcode` where it's
currently null — never overwriting a value AC already supplied) — deliberately
not built against the current, known-incomplete version of her spreadsheet.

## Decision: MailChimp-import population excluded (2026-08-29)

Investigating why List-1 registrants didn't match Lorraine's ground-truth
spreadsheet surfaced AC tag `[11] SOURCE: Mail Chimp Upload` — a historical
bulk import, not an organic registration through any tracked funnel. It
accounted for 683 of ~791 unexplained "extra" registrants. Lorraine, who
manually curated the registrant list for years (see `Consolidate.docx`),
never included this population — confirmed by Peter: "if the MailChimp-
import group are not in Lorraine's spreadsheet then we don't want them -
she was very careful to get all necessary contacts."

Implemented in `lib/registryPipeline/tagExclusion.ts` — excludes a contact
from ever becoming a registrant when the excluded tag is their *only*
signal (no genuine registration-funnel tag also matched). A contact who
was originally MailChimp-imported but later genuinely registered through a
tracked funnel keeps that legitimate attribution.

**Not yet built:** cleanup of the ~683 already-landed MailChimp-only
registrants from before this exclusion existed — same pattern as the List
3/5 cleanup (a script for Peter to review and run himself), not yet
written since the reconciliation work that surfaces the exact current
count is still in progress.

Also surfaced from the same tag list, not yet acted on — worth AFJ
leadership's judgment, not a pipeline decision: tag `[40]/[41]` "Mobilise -
Make a Donation" (94 contacts, financial-intent fields populated — same
sensitivity category that got List 5 excluded), and additional legitimate-
looking funnels `known_source_tags` doesn't cover yet (`[50]` "Pray for the
lost Oct 2019", `[52]` "New Zealand For Jesus Commitment" — NZ, not AU;
worth deciding if it belongs in an AU-states registry at all — `[6]`/`[8]`
TWOL video-request funnels).

## Reference: authoritative AC list sizes (2026-08-29, via ac_discovery.js)

Straight from AC, not inferred from our own (at-the-time-buggy) pull:

- List `[1]` Australia For Jesus Master: **10,454** contacts
- List `[2]` Way of Life Master: **4,204** contacts
- List `[3]` Business Life: 173 contacts (permanently excluded, plan 3.6)
- List `[5]` Tony Mclennan: 5 contacts (permanently excluded, plan 3.6)

Useful ceiling to sanity-check backfill completeness against — our own
distinct-contact counts should converge on these (roughly; some churn is
expected as the backfill catches up), not run indefinitely past them the
way they appeared to before the list-filter fix.

## Incident: wall-clock ceiling, not compute — and a real budget-check gap (2026-08-30)

After the list-filter fix, `ac-sync` kept hitting `WORKER_RESOURCE_LIMIT` /
`IDLE_TIMEOUT` at an increasing rate even with tightened time budgets
(60s/60s → 40s/40s → 25s/25s), eventually failing 100% of attempts right
after a clean deploy. Checked Supabase's own dashboard logs directly
(Functions → ac-sync → Logs → click an invocation for `cpu_time_used`):
a failed invocation ran boot-to-shutdown for **~150 seconds of wall clock
time** but used only **441ms of actual CPU time**. That's decisive: these
kills are a wall-clock execution ceiling (short on the Free plan — Peter
is upgrading Monday 2026-09-01, confirmed org-scoped via Supabase's own
billing docs, so it won't affect his other organization), not memory or
CPU exhaustion — the function is mostly idle, waiting on network I/O.

That also exposed a genuine gap independent of plan tier: the AC-pull
loop's deadline was only checked once per *page* (up to `PAGE_SIZE=100`
contacts, each its own network round-trip) — never between individual
contacts within a page. A single slow page could run arbitrarily long
past the nominal budget before the next check ever fired, which is likely
why real wall-clock time (~150s) was so much larger than the nominal
budget (~50s). Fixed in `lib/registryPipeline/sync.ts` — the deadline is
now checked before every contact, not just before every page. Confirmed
via a live invocation afterward: completed cleanly and fast, and a
subsequent batch ran 42 consecutive rounds with zero failures (down from
clusters of failures within the first 10-30 rounds beforehand) — though
at smaller throughput per round (~25-30 records vs ~100 before), a
reasonable trade for reliability while still on the Free plan.

**Until the Monday upgrade**, expect batches to need more, smaller rounds
rather than fewer, larger ones — this is now the stable, working mode on
the current plan tier, not a symptom of something still broken.

## Investigated and closed: Campaign Report data is not in AC (2026-08-30)

Jordan's raw AC export (`AFJ Tracking Export 20260827.xlsx`) includes a
"campaign report" sheet — aggregate per-campaign tallies (partial/full
presentations, sinner's prayer, information requests), submitted via
`www.australiaforjesus/campaignreport`. Confirmed **not** an AC-native
source: `ac_discovery.js`'s own Forms enumeration finds exactly 2 forms
in the account (the real `/register/` page and a leftover "Test" form) —
`campaignreport` isn't one of them.

Ruled out definitively with `ac_recent_activity.js` (new tool, see
`~/Development/ac-discovery/` — not part of this repo): swept every AC
contact created/updated on 2026-08-29, a day with ~18 campaigns run and a
standing requirement that leaders submit a report after each one. All 8
contacts touched that day showed only the two already-known patterns
(List 1 new registrations, List 2 individual wayoflife-responder
outcomes) — nothing in fieldValues, tags, Notes, or Deep Data
(`contactData`, which turned out to just be AC's own automatic geo-IP/
marketing-analytics tracking) resembling campaign-tally data. Zero trace,
despite a full day's worth of expected submissions.

Peter then confirmed directly (re-reading earlier correspondence with
Jordan, no need to re-contact him): Campaign Report submissions have
actually been going into a **Google Sheet**, not AC — Jordan's spreadsheet
tab is a literal dump of that. This pipeline was never the right place for
it; it's a completely separate data source.

**Follow-up (separate project, own thread):** giving this data a proper
structured home in this app, alongside/using its existing `results`/
record-results feature — initial load from Jordan's spreadsheet, then an
incremental catch-up dump once he provides one, then a replacement screen
before switching AFJ off the Google Sheets form entirely. Not part of the
registry pipeline's scope — no registry.* schema involvement.

## Known gap: registered_at/interested_in_training null for pre-2026-09-01 registrants

`acClient.ts` only started fetching AC's `contact.cdate` (used for
`registrants.registered_at`) and reading field `[9]` (`interested_in_training`)
from 2026-09-01 onward. Anyone already synced before that fix has staging
rows with no `cdate` key at all — confirmed directly (Aaron James,
ac_contact_id 3838: three staging rows spanning 2026-08-27/28, none with a
`cdate` key). Since the AC-pull backfill only moves forward through each
list's pagination, already-synced people won't naturally get a fresh pull
that would pick this up — `registered_at`/`interested_in_training` will
likely stay null for them indefinitely unless AC happens to re-touch their
record later (triggering a fresh incremental pull via `updated_since`).

Not urgent — nothing reads this data yet — but if it needs to be complete
rather than partial, a one-time script re-fetching just `cdate`/field `[9]`
for existing `registrants` rows where `registered_at IS NULL` (via
`GET /contacts/{id}` + `GET /contacts/{id}/fieldValues`, keyed on
`ac_contact_id`) would close the gap cheaply, without needing a full
re-backfill. `postcode` has the same *symptom* for pre-2026-08-26
registrants, but a different cause — AC itself never captured postcode
for them at all (see the postcode decision above), so no backfill script
can fix that one; this one, being purely a gap on this pipeline's side,
can.

## Incident: AC's list filter still not actually filtering — List 2 stuck scanning past its true size (2026-09-01)

Peter noticed `registry.registrants` hadn't grown in over a day despite
continuous "successful" batches. Investigated rather than assumed benign:
no new registrant since 2026-08-30T03:58 — every `registration_events` row
created since then was for an already-existing registrant. Traced to
`registry.sync_progress`: List 2's pagination offset had reached 12,852,
while its true size (via `ac_discovery.js`) is only ~4,204 — a genuinely
empty raw page from AC never occurred. Confirmed the content itself was
already fully discovered: distinct genuine List-2 contacts landed in
`staging.ac_events` across all history = 4,221, essentially the true
total. So List 2 had nothing left to find, but kept scanning anyway,
consuming half of every invocation's AC-pull budget that List 1 (which
still had real content left, offset 6,804 of ~10,454) could have used.

Root cause: `acClient.ts`'s list filter (`filters[listid]`, the earlier
best-effort correction after `filters[list]` was confirmed broken —
neither has ever been verified against a live raw API test) still isn't
filtering. Rather than guess at a third parameter name blind again, fixed
this at the orchestration level instead, where it's correct regardless of
what AC's API actually does: `lib/registryPipeline/sync.ts` now treats
`MAX_CONSECUTIVE_EMPTY_MATCH_PAGES` (50) consecutive pages with zero
genuine (post-filter) matches as list exhaustion, same as a literal empty
page — self-adapting, no dependency on ever finding the "true" AC
parameter name. Deliberately generous (50) since a false-early conclusion
would silently stop discovering a list's genuine remaining members, a
correctness regression far worse than some continued wasted scanning.

Not yet re-verified against live data post-fix (deploying now) — check
`sync_progress` after a few invocations: List 2 should clear/reset rather
than keep climbing, and List 1 should start getting a fairer share of
budget, resuming real registrant growth.

**Update — the consecutive-empty-page heuristic alone was not enough.**
List 2's offset kept climbing well past 4,204 even with
`MAX_CONSECUTIVE_EMPTY_MATCH_PAGES` deployed, because sparse *genuine*
matches (contacts already discovered many times before, but still
correctly on List 2) kept resetting the streak counter to 0 just before it
reached the threshold — "genuine match" only means the row's own `.list`
equals what was requested, not that it represents new content. Added a
second, independent safety net: `KNOWN_LIST_SIZES` (from the 2026-08-29
`ac_discovery.js` run: List 1 = 10,454, List 2 = 4,204) and
`MAX_OFFSET_MULTIPLIER = 3` — once a list's offset exceeds 3x its known
true size, treat it as exhausted unconditionally, regardless of recent
match activity. Deployed and confirmed via live data: a single test
invocation afterward showed List 2 no longer present in `sync_progress`
(cleared), while List 1 advanced further in that same invocation than it
had in several prior ones (7,156 → 7,188) — direct evidence it's now
getting the full AC-pull budget instead of splitting it with a futile
List 2 scan.

## Incident: incremental sync cursor could be silently corrupted by a failed run (2026-09-01)

Prompted by Peter's request to double-check for other unverified
assumptions like the list-filter one above. Traced
`getLastCompletedSyncTimestamp()` (`supabase/functions/ac-sync/db.ts`),
which supplies `filters[updated_since]` for every AC query — it used
`completed_at IS NOT NULL` as its proxy for "this run is a trustworthy
cursor source". But `failSyncLog()` *also* sets `completed_at` (on any
thrown error, e.g. an AC 502/503) — only `recordPartialSync()` (the normal
time-budget stop during this backfill) leaves it null. A failed run was
therefore indistinguishable from a genuinely completed one.

Confirmed via live data: the most recent non-null `completed_at` in
`registry.sync_log` belonged to id 83, a **failed** run from
2026-08-27T10:57:46 ("AC API error 503 calling
/contacts/7379/contactTags") — no genuine full sync has ever completed
during this backfill (every run since has been `partial`), so the cursor
has been silently stuck on that failure's timestamp the entire time. No
data loss has resulted yet, for two independent reasons: (1) the backfill
has never advanced far enough for a real `completeSyncLog` to occur, and
(2) `filters[updated_since]` itself is unverified against live AC data —
see the open question below — so it may not even be doing anything today.
But this would have silently and permanently corrupted every future
scheduled/incremental sync's window the moment either of those two things
stopped being true, with no error or warning of any kind.

Fixed by adding an explicit `status` column (`'success' | 'partial' |
'failed' | 'crashed'`) to `registry.sync_log`, set explicitly by each of
`completeSyncLog`/`recordPartialSync`/`failSyncLog`, and changing
`getLastCompletedSyncTimestamp()` to filter on `status = 'success'`
instead of `completed_at IS NOT NULL`. See
`scripts/add_status_to_sync_log.sql` (includes a backfill of historical
rows). While auditing, also found 46 orphaned rows (`completed_at` AND
`notes` both null — the invocation was killed by the platform before any
of the three log-writer functions ran, i.e. `WORKER_RESOURCE_LIMIT`/
`IDLE_TIMEOUT`), all dated 2026-08-30/31, none since the 65s/65s budget
settled; backfilled to `status = 'crashed'` so they're never mistaken for
a real success. `db.ts` is a Deno-only adapter with no Vitest coverage by
design (same as `acClient.ts` — see its header comment); this fix is
verified via live data above and a fresh live re-check after deploying,
not a new unit test, consistent with that existing precedent. The doc
comments on `DbPort.getLastCompletedSyncTimestamp`/`recordPartialSync`
(`lib/registryPipeline/ports.ts`) were updated to match.

## Open question, not yet resolved: does `filters[updated_since]` actually filter?

Same `/contactLists` endpoint and `filters[X]` convention as `filters[list]`
and `filters[listid]` — both now confirmed broken (see the two incidents
above). The technical plan itself flagged this as unverified in Sections
6.1 and 10 ("verify against real data early... before relying on it for
incremental sync"), and it has never been tested against live AC data,
because `lastSync` has effectively been null/meaningless throughout this
backfill (see the incident above). If it's ALSO broken, every future
"incremental" scheduled sync will silently re-scan the entire account from
offset 0 again, rather than only pulling what actually changed — the same
class of bug as the list filter, just not yet observable because we
haven't reached the point where it would matter.

A definitive test script — `ac_updated_since_probe.js`, alongside the
existing `ac_discovery.js`/`ac_contact_lookup.js`/`ac_list_sniff.js` — was
added to `~/Development/ac-discovery/` (outside this repo, run manually by
Peter with his local AC credentials, same pattern as those other scripts).
It queries the same list twice with the same limit — once with no filter
(control) and once with `filters[updated_since]` set a few minutes in the
future — and reports whether the future-dated query still returns rows
(no real AC record can have been updated in the future, so any overlap
with the control set is decisive proof the filter is ignored, mirroring
exactly how `filters[list]`/`filters[listid]` were caught). **Not yet run**
— needs Peter to run it locally and share the output, same as
`ac_discovery.js` earlier. Should be done before cron scheduling
(`scripts/schedule_ac_sync_cron.sql`) is ever enabled.

## Investigated, no live evidence of a problem: parallel-call burst vs AC's 5 req/sec shared limit

`acClient.ts`'s `getContactDetail()` fires 3 AC calls concurrently
(`Promise.all` for the contact record, its field values, and its tags),
followed by one `REQUEST_PACING_MS` (250ms) sleep before the next
contact — a burst-then-pace pattern rather than a steady one-request
spacing. Worth flagging because the account's AC key is shared,
account-wide, with other integrations (plan Section 3.2), so a burst of 3
has less headroom than the raw 5 req/sec figure suggests, and a resulting
429 would eat several seconds of `computeBackoffMs` retry delay per
occurrence — silently, since a successfully-retried 429 never increments
`sync_log.errors`, it would just show up as fewer `recordsIn` per
invocation than the budget/page-size math predicts.

Checked the last 15 `sync_log` rows (2026-09-01, current 65s/65s budget):
`records_in` is consistently 59-69 per invocation, matching what
`computePageSize`'s `ESTIMATED_MS_PER_CONTACT = 1000` assumption predicts
for two ~32.5s list slices with no meaningful throttling overhead, and
`errors = 0` throughout. If 429 backoff were happening at any real
frequency, per-invocation throughput would be visibly and inconsistently
depressed below that prediction — it isn't. Conclusion: not causing a
live problem right now, but it's a structural risk that depends on how
much of the shared 5 req/sec other integrations are using at any given
moment, so it's worth keeping in mind rather than closing outright — if
`records_in` ever drops well below the ~60-70/invocation norm without a
budget change, this is the first thing to re-check.
