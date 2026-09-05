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
  mfaGate.ts                      evaluateMfaGate() — pure routing decision for the /registry portal below
  __tests__/                      Vitest coverage for everything above (Node-safe; no Deno/Supabase dependency)

app/registry/                   The leader-facing auth portal (magic-link + MFA) — see the dated section below
  login/page.tsx                   Email -> magic link (shouldCreateUser: false, invite-only)
  auth/callback/page.tsx           Client-side code exchange (must run in-browser, see the app/auth/callback fix)
  mfa/enroll/page.tsx              First-time TOTP setup (QR code)
  mfa/challenge/page.tsx           Returning-user TOTP challenge
  no-access/page.tsx               Valid sign-in, no registry.leader_roles row
  page.tsx                         Placeholder landing page once the gate passes
  useRegistryGate.ts               Shared hook: re-evaluates the gate on mount, redirects if not yet allowed
lib/registryAuth.ts             SDK glue: reads leader_roles + AAL/factors, sets/clears the registry_auth / registry_session cookies
lib/registrySupabaseClient.ts   Second supabase-js client, isolated localStorage key — see below for why
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

## Incident: `filters[updated_since]` is also ignored by AC — no working incremental filter exists on this endpoint (2026-09-01)

Confirmed via `ac_updated_since_probe.js`, run live by Peter against List 2:
a control query (no filter) and an otherwise-identical query with
`filters[updated_since]` set several minutes in the *future* both returned
the same 10 rows, fully overlapping. No real AC record can have been
updated in the future, so this is decisive: AC is not applying this filter
server-side, exactly like `filters[list]` and `filters[listid]` before it.
All three `filters[X]` parameters tried against `/contactLists` in this
project have now turned out to be no-ops. It's reasonable to assume this
endpoint's `filters[...]` support is broadly unreliable rather than
treating any future parameter on it as trustworthy without a live test
first.

**Consequence, once the initial backfill finishes and a genuine
`completeSyncLog` occurs:** `lastSync` will become non-null, but since AC
ignores it, every subsequent "incremental" sync will keep receiving the
FULL unfiltered list from offset 0 again — not a correctness bug (upserts
are keyed on `ac_contact_id` and idempotent, and `filters[updated_since]`
being sent-but-ignored is harmless dead weight), but it defeats the entire
point of incremental sync: every scheduled run would re-walk and
re-fetch-detail for the whole ~14,700-contact account from scratch, rather
than only what actually changed. At ~1s/contact that's several hours of
AC-pull work to re-discover nothing new, repeated on every cron cycle.

**Not fixed yet — needs a design decision, not a quick patch,** unlike the
list-filter bug (which had a clean client-side substitute: discard rows
whose `.list` doesn't match). There's no equivalent for `updated_since`
from this endpoint: `/contactLists` doesn't return a per-membership
"updated at" timestamp to filter on client-side. Two directions worth
weighing before building either:
1. **Accept full re-scans on every incremental run.** Simplest, no code
   change beyond what's already in place — just size the cron interval
   and per-run budget around "one full account re-scan takes N
   invocations," and lean on the fact that it's wasteful but not wrong.
2. **Re-architect the incremental path around `/contacts?filters[updated_after]=`**
   instead of `/contactLists` — this is the endpoint `ac_recent_activity.js`
   used successfully earlier (see "Investigated and closed: Campaign
   Report data is not in AC" above) to sweep contacts by day window,
   though that use never specifically stress-tested the filter's
   reliability the way this incident's probe did for `/contactLists`, so
   it would need the same kind of live verification before being trusted.
   Would mean fetching a candidate set of recently-changed contact IDs
   globally first, then checking list membership only for those — a
   genuinely different shape from the current per-list pagination loop.

Cron scheduling (`scripts/schedule_ac_sync_cron.sql`) should stay deferred
until one of these is chosen and built — enabling it today would mean
every scheduled run silently doing a full, expensive re-scan indefinitely.
Not urgent while manual batching continues (each invocation already
behaves like a full-scan step regardless, since `lastSync` has never been
non-null) — this only becomes live the moment the backfill actually
completes.

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

## Fixed: known-worthless detail fetches (list-status-inactive) skipped without an AC call (2026-09-01)

Prompted by Peter asking directly: "are we only retrieving the AC records
we need, or are we retrieving more?" Quantified with live data against
`staging.ac_events` (54,385 rows total, every one a full 3-call
`getContactDetail` fetch):

| What | Count | % of all fetches |
|---|---|---|
| Fetched in full, then discarded at transform: list status not active | 987 | 1.8% |
| Fetched in full, then discarded at transform: MailChimp-tag-only (excluded source) | 3,321 | 6.1% |

The list-membership-level over-fetch from the broken `filters[listid]`
(mixed-in List 3/5 rows) was already handled — those never reach
`getContactDetail` at all (discarded via `rawPage.filter(...)` before the
per-contact loop, see the Fourth deviation above); the two rows above are
a different thing: contacts genuinely on List 1/2, fetched in FULL, then
discarded at transform time for a reason we already knew *before* the
detail fetch.

Fixed the cheaper of the two: `membership.status` (active/bounced/etc.)
is already present on the row returned by the list-page call, before any
detail fetch — moved `isActiveListStatus()` (already used in
`transform.ts`) into `sync.ts`'s per-contact loop, skipping
`getContactDetail`/`insertStagingEvent` entirely for an inactive
membership. Zero new AC calls, no restructuring, no `DbPort`/schema
change — `transform.ts`'s existing check is untouched (harmless, since it
will simply never see one of these rows going forward). Verified
red→green: the new test
(`lib/registryPipeline/__tests__/sync.test.ts`, "skips the detail fetch
and staging insert entirely for a membership whose status is not
active") fails against pre-fix `sync.ts` (2 `getContactDetail` calls
instead of 1) and passes against the fix.

**Deliberately not fixed:** the MailChimp-tag-only case (6.1%, larger).
Excluding it earlier would mean reordering `getContactDetail` to fetch
`contactTags` first and short-circuit before `contact`/`fieldValues` —
changes `AcPort`'s contract in `acClient.ts`, for a smaller per-contact
saving (cuts 1 of 3 calls, not all 3, since the tags call is still
needed either way). Deferred as a separate, deliberate piece of work if
it's ever worth it, not folded into the in-progress backfill.

## Reconciliation against Lorraine's spreadsheet — first pass (2026-09-01)

Compared `registry.registrants` (9,134 rows) against Lorraine's "main AFJ
page" sheet (`AFJ Soulwinners to14 Aug 2026 16th.xlsx`, 9,208 rows),
matching on normalized email and normalized phone (same `normalizePhone()`
logic as `lib/registryPipeline/phone.ts`, reimplemented in Python for the
comparison — see `~/…/scratchpad/reconcile/` for the working
files, kept out of the repo since they hold PII).

Raw result: only ~5,234 matched (~57%) — 3,974 in Lorraine's sheet with no
match in the registry, 3,837 in the registry with no match in her sheet.
Ruled out normalization bugs as the cause before reporting this: email and
phone overlap independently land at nearly the same rate (~55%/~58%), and
both sheets have near-identical email domain distributions — a formatting
bug would show one field matching fine while the other looked broken; it
doesn't.

**Critical context from Peter, changes how to read the above:** "main AFJ
page" is explicitly **not** meant to be a 1:1 mirror of AC List 1. Lorraine
built it from Jordan's earlier live-updating spreadsheet via her own
documented process (not a direct AC export) — so a large non-overlap may
be entirely expected from that different lineage, not a pipeline defect.
Peter has asked Lorraine to confirm whether she's ever folded in
registrations from another source; **holding off on drawing any
conclusion from this reconciliation, or making any pipeline change because
of it, until that answer comes back.**

Independent of the lineage question, one real, separate data-quality issue
surfaced while checking this and is worth a follow-up regardless of the
outcome above: a minority of `registry.registrants.phone` values
normalize to implausible lengths (as short as 4 characters, one as long
as 29) — not the majority (93% are a clean, normal 12-character E.164
value), but worth a targeted query + spot-check once there's time,
independent of the reconciliation.

## `/contacts` probe results — Proposal 2's assumptions substantially confirmed (2026-09-01)

Peter ran `ac_contacts_pagination_probe.js` (see
[FORWARD_SYNC_REDESIGN.md](./FORWARD_SYNC_REDESIGN.md)'s Proposal 2)
against live AC data:

- **Pagination is stable**: identical page (offset=100, limit=20) fetched
  twice, 8 seconds apart, returned identical contact IDs in identical
  order. Directly answers the open question from the redesign — safe to
  page through `/contacts` without a reordering risk.
- **`orders[id]=ASC` works**: returned IDs in clean ascending order
  (122–141 in the sample) — supports an id-based cursor exactly as
  proposed.
- **`filters[created_after]` works**: a future-dated filter correctly
  returned zero rows against a 20-row control. The *first* AC filter of
  any kind, on any endpoint, in this whole project to pass the future-date
  test — every `filters[...]` param tried on `/contactLists`
  (`list`/`listid`/`updated_since`) failed it.
- **List membership is NOT embedded** in a `/contacts` response (checked
  all top-level keys on a real contact — none list-related). Resolves the
  redesign's open "list-membership tradeoff" question in favor of option
  (a) (a scoped per-contact `/contactLists` check for newly-discovered
  contacts only) — not a recommendation anymore, the only viable option,
  since (b) (rely on an embedded list array) isn't available at all.

**Update — `filters[updated_after]` also confirmed working** (rerun,
2026-09-01): future-dated filter correctly returned zero rows against the
same 20-row control. Every assumption Proposal 2 depends on is now
confirmed against live data: stable pagination, `orders[id]=ASC`,
`filters[created_after]`, `filters[updated_after]`, and no embedded list
membership (settling the list-membership tradeoff in favor of option (a)).
Proceeding to implementation.

## Proposal 2 implemented and deployed (2026-09-01)

Replaced per-list `/contactLists` offset pagination with the single
account-wide `/contacts` id-cursor sweep from
[FORWARD_SYNC_REDESIGN.md](./FORWARD_SYNC_REDESIGN.md). Changes:
`AcPort.getContactListPage` → `getContactsPage` + `getContactListMemberships`;
`sync.ts`'s main loop rewritten around a single sweep (no more per-list
fair-slicing); dead code removed (`MAX_CONSECUTIVE_EMPTY_MATCH_PAGES`,
`MAX_OFFSET_MULTIPLIER`, `KNOWN_LIST_SIZES` — all safety nets built for
the now-removed offset/broken-filter combination); `registry.sync_progress`
reused as-is with a new sentinel key (`'contacts'`) rather than a schema
migration — the old `list_id='1'`/`'2'` rows are now orphaned and
harmless, never queried again.

All 4 CI gates pass (tsc, lint, 550 tests — sync.test.ts fully rewritten
for the new interface, 20 tests including 5 new ones covering the
redesign's specific guarantees: no detail fetch for a non-qualifying
contact, excluded-list memberships ignored alongside a genuine one,
defense-in-depth against an unverified `filters[contact]`, one detail
fetch reused for a contact on both lists). Deployed via `supabase
functions deploy ac-sync` — no Deno-side type-checker available locally
(`deno` not installed in this environment), consistent with this file's
existing precedent for `acClient.ts`/`db.ts` — verified live instead.

**Live verification:** first test invocation succeeded cleanly
(`recordsIn: 2, errors: 0`), `sync_progress` correctly created a new
`'contacts'` row (the old `'1'`/`'2'` rows untouched, as expected). Ran a
short follow-up batch — offset advanced steadily (0 → 64 → 128 → 160 →
192...), staging rows landed with the correct shape and processed cleanly
through the *unchanged* transform step (`source_list_id` populated,
`processed_at` set, no `processing_error`). Registrant growth not yet
re-confirmed at a meaningful scale — this backfill just restarted from
offset 0 under the new sweep order (a different traversal order than the
old per-list one), so it will take a number of invocations before it
reaches contacts genuinely new to `registry.registrants`. Will report
back with real growth numbers once the batch has run for longer.

## Regression found: `filters[contact]` on `/contactLists` is very likely broken (2026-09-01)

Confirmed via live data, not assumed. The batch run after deploying
Proposal 2 covered AC contact IDs 6–1120 and found only **2** genuine
List 1/2 matches. Checked against `staging.ac_events`' full historical
record: IDs 6–1120 include **1,099 already-known genuine List 1/2
members** — membership is essentially dense/uniform across the whole ID
range (~1,000 per 1,000-id bucket, all the way to 14,000+), not sparse at
the low end. Expected roughly 1,099 matches, found 2 — this is a real bug
in `getContactListMemberships`'s `filters[contact]=<id>` call
(`acClient.ts`), not a benign "early IDs are pre-registration test
contacts" explanation.

That param was explicitly flagged as unverified when written (see its own
code comment) — this is now direct evidence it doesn't work as intended,
consistent with every other `filters[...]` param tried on this same
endpoint (`list`, `listid`, `updated_since` — all confirmed broken).
Unlike those, which returned *too much* unfiltered data, this one appears
to return close to *nothing* for a genuine member — plausibly because
`/contactLists` doesn't support a `contact` filter at all (invalid/silently-
ignored-as-no-match, rather than ignored-as-return-everything), or because
the correct shape is AC's nested-resource pattern instead
(`/contacts/{id}/contactLists`, matching `/contacts/{id}/fieldValues` and
`/contacts/{id}/contactTags`, which this pipeline already uses
successfully elsewhere).

**Resolved.** Peter ran `ac_contactlists_by_contact_probe.js` against
contacts 6, 10, 11, and 12 — decisive result: `filters[contact]` returned
the exact same fixed 20-row page for all four (confirming it's a no-op),
while `/contacts/{id}/contactLists` returned a different, correct,
contact-specific result for each one. Fixed `acClient.ts` to use the
nested-resource path.

**Before redeploying, reset `registry.sync_progress`'s `'contacts'`
cursor back to 0** — it had already advanced to 1,120 under the broken
code; leaving it in place would have permanently skipped every contact in
that range once the fix landed, since the cursor only ever moves forward.
Verified post-fix with a fresh invocation over that same range: 43
staging events landed from just 32 contacts (matching the known
multi-list membership density for that range — a complete reversal from
the pre-fix result of 2 matches across 1,120 contacts). Resuming
batching.

## Strategic pivot: reload from Lorraine's spreadsheet instead of finishing the AC backfill (2026-09-02)

Peter got further input from Lorraine: her "main AFJ page" sheet includes
registrations she's **added manually from other sources**, and she has
**more to add this week** before a final version is ready — resolving the
open question from the earlier reconciliation ("is this meant to be 1:1
with AC List 1?" — no, confirmed).

**New plan, superseding the "finish the historical backfill" goal:**

1. Wait for Lorraine's final "main AFJ page" spreadsheet.
2. Do a complete reload of `registry.registrants` from that spreadsheet —
   it becomes the source of truth for everything up to her cutoff, not
   AC.
3. AC sync's job going forward is narrower and clearer: pick up only
   *new* registrations from **2026-08-22** onward (her sheet's cutoff —
   or later, if she adds more manually-sourced records after that date).
4. Everything built and fixed today (the `/contacts` id-cursor sweep, the
   `getContactListMemberships` fix) remains exactly the right mechanism
   for that job — Peter explicitly confirmed this work is "critical to
   ensuring that we can pick up and store new registrations accurately
   and efficiently" regardless of the pivot.

**Decision: stopped the exhaustive historical backfill batching.**
Continuing to grind through the full ~14,000+-contact account is now low
value — that data will be replaced by Lorraine's spreadsheet regardless
of how thoroughly AC is backfilled, and AC's rate limit is a shared,
finite resource other integrations also depend on. Replaced with a
smaller, more targeted goal: prove the **incremental** discovery pathway
(`filters[updated_after]`) actually works for real, not just the
future-dated edge case already confirmed. This matters structurally: that
code path only ever activates once `getLastCompletedSyncTimestamp()`
returns non-null, which requires a fully-completed pass — and a full pass
over the whole account was never going to finish naturally before this
pivot anyway, so the exact capability this pivot now depends on had never
actually been exercised end-to-end. Extended
`ac_contacts_pagination_probe.js` (section 4) to test a **past**-dated
`filters[updated_after]` — checking it genuinely narrows the result (not
just passing the negative future-date test) and that every returned
contact's `udate` genuinely postdates the filter. Result pending Peter
running it.

**Real correctness trap identified and deliberately NOT solved with new
infrastructure yet:** Peter asked whether new (post-cutoff) registrations
landing via AC sync between now and the reload should go into a separate
temporary table, since `registry.registrants` will need to be emptied and
reloaded once Lorraine's spreadsheet arrives. The underlying risk is
real: `staging.ac_events` rows get `processed_at` set once
`transform.ts` has handled them, and `getPendingStagingEvents` only ever
returns rows where `processed_at IS NULL` — so if `registry.registrants`
is later truncated and reloaded without special handling, **any
already-processed post-cutoff registrant would never be picked up again
by the normal transform flow**, permanently lost from the rebuilt table.

**Decided: don't build a temp table now.** The exact shape of the fix
needed (a one-time script re-deriving post-cutoff registrants from
`staging.ac_events` by `registered_at`/date, independent of
`processed_at`, run right after the reload) depends on details not known
yet — Lorraine's exact final cutoff date/time, whether `registered_at`
(AC's `cdate`) is really the right field to filter on, and how to
de-duplicate against anyone she's also captured manually past that
cutoff. Building schema/code for this now would mean guessing at
requirements that will be concretely known once her spreadsheet actually
arrives. In the meantime, `staging.ac_events` already holds the complete
raw record regardless (append-only, never purged) — nothing is at risk
of being lost by waiting; `registry.registrants` keeps being written to
normally in the meantime, and the reload script (to be written when her
spreadsheet lands) is responsible for re-deriving anything the truncate
would otherwise discard.

## Section 4 probe result was inconclusive, not a finding — fixed and reran (2026-09-02)

First run of section 4 (7-day-past `filters[updated_after]`) came back
"20 rows vs 20 unfiltered" — looked like a non-narrowing filter, but this
was a flaw in the probe, not a real result: both calls are capped at the
same `limit=20`, so if more than 20 contacts genuinely matched, both
would coincidentally show the same count regardless of whether the filter
works. Rewrote the check to look at what actually matters — every
returned contact's own `udate`, which must be `>= cutoff` if the filter
is genuinely working, independent of row count — and narrowed the window
from 7 days to 6 hours, since `udate` bumps on routine AC bookkeeping
(opens, scoring, bounces, other shared-account integrations) too, not
just list-membership changes, so 7 days on an active account can hit
`limit` on its own for reasons unrelated to what's being tested. Rerun
pending.

6-hour window came back genuinely empty (not limit-capped this time — 0
rows). Made section 4 self-escalating (6h → 24h → 7d → 30d → 90d,
stopping at the first window with a non-empty sample) so this doesn't
need another manual rerun to find real data to check. Rerun pending.

**Confirmed working (24-hour window, 2026-09-02).** 4 contacts returned,
every one's `udate` genuinely postdates the requested cutoff
(2026-09-01T00:49:03.588Z) — checked precisely, including the `-05:00`
timezone offset on the returned values (e.g.
`2026-09-01T04:13:34-05:00` = `09:13:34Z`, well after the cutoff).
`filters[updated_after]` is now proven with a real positive case, not
just the future-date edge case — the exact capability this pipeline
needs for picking up new registrations going forward (the pivot's core
requirement) is confirmed working end-to-end at the AC API level.

**Status:** registry pipeline work paused here pending Lorraine's final
spreadsheet. Everything needed for the next phase is in place and
verified:
- Discovery mechanism (`/contacts` id-cursor sweep + per-contact
  `/contacts/{id}/contactLists` membership lookup) — built, fixed, and
  live-verified.
- Incremental filtering (`filters[updated_after]`) — now confirmed
  genuinely working, not just passing the negative future-date test.
- Duplicate-person handling and the `/admin/registry-duplicates` review
  screen — designed (FORWARD_SYNC_REDESIGN.md), build gated on a minimal
  Supabase Auth slice for Lorraine (Peter's decision, 2026-09-01), not
  yet built.
- Reload-from-spreadsheet plan and its `processed_at` correctness trap —
  documented above, script itself deferred until Lorraine's real cutoff
  details are known.

## `/registry` portal: magic-link + MFA sign-in built (2026-09-05)

Built the "minimal Supabase Auth slice" referenced above — the previously
out-of-scope item from BRIEF.md ("Supabase Auth (magic-link) rollout for
leaders" + "MFA enforcement for `national_admin`/`whatsapp_admin`") — as an
independent `/registry` route namespace, deliberately not nested under the
main app's `/admin` (which is gated by the mobile+name login and a
different admin concept, `state_leaders.admin = 'AD'`; a `national_admin`
here doesn't need to be a state leader at all).

**Session isolation.** `lib/registrySupabaseClient.ts` is a second
`createClient()` instance (same project URL/anon key as
`lib/supabaseClient.ts`) with its own `storageKey` (`afj-registry-auth`).
Without this, both clients would share one `localStorage` session slot —
signing into `/registry` on a device would silently evict the main app's
anonymous mobile+name session there, and vice versa. With separate storage
keys, both sessions coexist on the same browser.

**Flow:** `/registry/login` (email, `shouldCreateUser: false` — invite-only,
see seeding below) → magic link → `/registry/auth/callback` (client-side
`exchangeCodeForSession`, same reasoning as the `app/auth/callback` fix
below) → `lib/registryAuth.ts`'s `getRegistryAccessState()` reads the
caller's own `registry.leader_roles` row (RLS-scoped) plus their current
AAL/enrolled factors, and `lib/registryPipeline/mfaGate.ts`'s
`evaluateMfaGate()` (pure, unit tested) decides the next screen:
`/registry/mfa/enroll` (first-time TOTP setup + QR code) or
`/registry/mfa/challenge` (returning user, enter code) or straight to
`/registry` if the role doesn't require MFA or `aal2` is already current.
`/registry/no-access` catches a valid sign-in with no `leader_roles` row.

**Route protection** (`middleware.ts`) uses two cookies, not one — a UX
guard only, same disclaimer as `app_session`, real enforcement is RLS +
`registry.has_required_mfa()`: `registry_auth` (set right after the code
exchange, before the MFA outcome is known — needed so `/registry/mfa/*`
itself is reachable) and `registry_session` (set only once the gate
returns `ok`, required for everything else under `/registry`).

**Fixed in passing:** `app/auth/callback/route.ts` (the *main* app's
existing, currently-unused magic-link callback, from PR #44 in May) had
the same class of bug this portal would otherwise have repeated — it ran
`exchangeCodeForSession()` in a server Route Handler using the
browser-oriented client, so the resulting session had no browser
`localStorage` to persist to. Converted to a client component page. Not a
registry-pipeline file, so shipped as a separate PR — see main-branch
history (`fix/auth-callback-client-side-exchange`).

**Seeding access:** `registry.leader_roles.user_id` FKs to `auth.users`,
and the invite-only login means someone needs an `auth.users` row before
they can ever request a magic link. `scripts/seed_registry_leader_roles.ts`
handles both steps — invites (creates `auth.users`, sends the invite email)
anyone not already present, then upserts their `registry.leader_roles`
row. Also required: `scripts/grant_registry_authenticated_schema_usage.sql`
— `registry.leader_roles`' own `GRANT SELECT ... TO authenticated` isn't
enough on its own, same gap `grant_registry_pipeline_service_role.sql`
already documented for `service_role` (schema `USAGE` is a separate
privilege from any per-table grant).

**Update (2026-09-05) — live-verified, two real bugs found and fixed
along the way, before merge to `main`:**

- The magic-link/invite callback shape was wrong: it checked
  `window.location.search` for a `?code=` param and gave up immediately
  when absent. Confirmed live that this project's actual default auth
  flow ('implicit') delivers the session as a `#access_token=...` URL
  hash fragment, never a `?code=` — every genuine successful sign-in was
  being treated as a failure. Fixed by setting
  `detectSessionInUrl: true` on `registrySupabaseClient.ts` (handles both
  shapes automatically) and having the callback page wait for the
  resulting `SIGNED_IN` event instead of parsing the URL itself. The
  identical mistake, caught the same way, was also fixed in the main
  app's own `app/auth/callback` before it ever shipped (separate PR).
- `supabase.auth.mfa.enroll()`'s own `totp.qr_code` field — confirmed
  live to be **362,632 characters** for a 231×231px code (a known
  upstream inefficiency in how GoTrue's SVG library draws it) — is
  unusable as an `<img>` `data:` URI regardless of encoding; two
  encoding attempts (raw concatenation, then `encodeURIComponent`) both
  rendered blank. Fixed by rendering a compact QR code client-side
  (`react-qr-code`) from `totp.uri` instead — the actual small
  `otpauth://totp/...` string the bloated SVG encodes — never touching
  `qr_code` at all.
- Found and fixed while diagnosing the above: a second `mfa.enroll()`
  call (e.g. a page reload, or any retry after a first attempt didn't
  complete) gets rejected with a 422 "factor name conflict", since every
  call defaults to the same empty `friendly_name`. Without a fix this
  would permanently strand anyone who ever retries enrollment. Fixed by
  unenrolling any stale unverified TOTP factor before enrolling a fresh
  one, in `app/registry/mfa/enroll/page.tsx`.

Sign-in + MFA (enrollment and challenge) confirmed working end to end on
production (`campaign.afj.org.au`) for `plvmx01@gmail.com`, after the
first two fixes above; the QR/conflict fixes came after that, verified
via `scripts/debug_totp_enroll_response.ts` (a throwaway diagnostic that
reproduces the enrollment call server-side, no browser needed) rather
than a further live UI round-trip — worth one real browser test with a
fresh account (e.g. `lily.viertmann@gmail.com`, already seeded) before
fully trusting the QR fix.

Confirm Dashboard → Authentication → Multi-Factor Authentication has
TOTP enabled if it hasn't been checked yet (OPERATIONS.md step 6 above
covers availability, not enforcement).
