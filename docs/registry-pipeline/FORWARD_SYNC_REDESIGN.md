# Design note: making ongoing AC sync trustworthy

Companion to [OPERATIONS.md](./OPERATIONS.md) (the incident/decision log this
draws its evidence from) and
[AFJ_PII_Technical_Implementation_Plan.md](./AFJ_PII_Technical_Implementation_Plan.md)
(the original design this revises). **Not yet implemented — this is a
proposal for review before any code changes**, per Peter's explicit request
(2026-09-01): AC will shortly become the *only* channel new registrations
arrive through, so the ongoing/incremental sync has to be provably reliable,
not just "probably fine now that a few bugs are fixed."

## Why this is needed — the evidence

Two separate, unrelated problems, both confirmed against live data on
2026-09-01 (see OPERATIONS.md for the full incident write-ups):

**1. Duplicate people.** Checked `registry.registrants` for internal
duplicates: **zero** email collisions across different `ac_contact_id`s (AC
dedupes reliably by email), but **196 distinct phone numbers are shared
across multiple different `ac_contact_id`s, affecting 421 registrant rows
(~4.6% of the table)** — every case has a *different* email between the
duplicates. Mechanism: the same real person submits a second AC form with a
different (or mistyped) email but the same phone; AC creates a new contact
rather than recognizing them; our pipeline, keyed strictly on
`ac_contact_id`, creates a second registrant row. Nothing in the current
design catches this, historically or going forward.

**2. Discovery is not reliably finding new people.** `registry.registrants`
had essentially zero growth (2026-08-28 through 2026-09-01, aside from a
tiny trickle on 08-30) despite continuous "successful" invocations
(`errors: 0`, offsets climbing). Full-history check of `staging.ac_events`
(58,138 rows) found only **14,078 distinct contacts** behind List 1's
40,678 fetches, and **4,221 distinct contacts** behind List 2's 17,460 —
some individual contacts re-fetched **300+ times each**. The worst
repetition clusters in one narrow band of consecutive AC contact IDs,
consistent with debris from stall bugs already fixed earlier this session
— but the underlying condition that produced it (`filters[updated_since]`
on `/contactLists` confirmed to do nothing, forcing every "incremental"
sync to restart each list from offset 0) is still present today. There is
currently no positive evidence the design reliably converges on "found
everyone," only evidence that it hasn't for four days running.

Both problems trace back to the same root design choice: trusting
`/contactLists`'s `filters[...]` and offset-based pagination, none of which
have held up under live testing (`filters[list]`, `filters[listid]`, and
`filters[updated_since]` are all now confirmed non-functional — see
OPERATIONS.md's three incidents).

## Proposal 1: duplicate-person handling — flag, don't auto-merge

**Recommendation: surface phone-collisions for review, never silently
merge two `ac_contact_id`s into one identity automatically.**

A shared phone number is suggestive, not proof — a couple, a family, or a
shared church-office phone can legitimately produce this pattern for two
*different* real people. Auto-merging risks silently losing or
misattributing one person's data, which is a worse failure mode than
leaving a duplicate for a human to resolve. This is a data-quality
judgment call, not a mechanical one, matching the pattern the whole
pipeline already follows in one specific way (Lorraine's spreadsheet,
leadership sign-off) of putting the *decision* in front of a person rather
than automating it away.

**Sketch:**

- New column `registry.registrants.possible_duplicate_of UUID REFERENCES registry.registrants(id)`, nullable.
- In `transform.ts`, before `upsertRegistrant` for a genuinely new
  `ac_contact_id`: look up any *existing* registrant sharing the same
  normalized phone. If found (and it's a different `ac_contact_id`), set
  `possible_duplicate_of` on the new row pointing at the existing one.
  Never touches or overwrites the existing row.
- Runs going forward on every new contact automatically; a **one-time
  backfill script** (same pattern as the postcode/training backfill
  already flagged as a known follow-up) does the same check across the
  421 already-landed rows.
- No UI/admin screen for reviewing these in this pass — out of scope,
  same as the RLS-scoped leader views already deferred in BRIEF.md. The
  column just makes the linkage queryable (`WHERE possible_duplicate_of
  IS NOT NULL`) for a manual SQL check or a future screen.

**Open question for Peter:** should a duplicate found via phone still
receive its *own* independent WhatsApp invite / follow-up contact later
(when that phase is built), or should `possible_duplicate_of` rows be
excluded from anything contact-facing until a human confirms them?
Affects how urgently the review screen is needed — not blocking this
schema change either way.

## Proposal 2: replace offset-based `/contactLists` discovery

**Recommendation: switch primary discovery to AC's `/contacts` endpoint,
ordered and paginated by the contact's own immutable, monotonically
increasing `id` — never by a page offset — with `filters[listid]` still
used per-contact to resolve list membership, not as the discovery
mechanism itself.**

### Why offset-based `/contactLists` pagination can't be trusted

An offset is a *position*, not an *identity* — correct only if the
underlying result set never reorders between calls. We've now proven three
different `filters[...]` params on this exact endpoint don't do what
they're documented to do; there's no remaining reason to trust its
ordering guarantees either without a live test, and the repeated-fetch
evidence above is exactly the failure mode you'd see if it doesn't hold.

### Why contact `id` is a safe cursor

AC contact IDs are sequential integers, assigned once, never reused or
reordered (confirmed from real data across this whole session — e.g. IDs
6 through 14,294+, monotonically increasing with contact recency). A
cursor of "highest `id` fully processed so far" is correct regardless of
whatever else is happening concurrently in the shared AC account, with no
dependency on AC's pagination staying stable between calls.

### Open questions — need live verification before implementation, not assumed

Every `/contactLists` filter tried so far turned out broken; nothing about
`/contacts` should be assumed to work differently without the same kind
of test used to catch the others. Before writing any code:

1. **Does `/contacts` support `orders[id]=ASC` (or is ascending-by-id
   already its default)?** Verify the same contact set, fetched twice with
   a gap, returns pages in identical order both times.
2. **Does `/contacts` support a genuine `id`-range filter** (e.g.
   `filters[id_greater]`, or similar — AC v3's documented filter syntax is
   mostly exact-match, so this may not exist as a first-class param) — if
   not, the cursor still has to be enforced client-side (fetch a page
   ordered by id, discard anything `<= last_seen_id`, which is safe as
   long as ordering is genuinely stable, just not maximally efficient).
3. **Does `/contacts`' own `filters[created_after]`/`filters[updated_after]`
   actually filter**, unlike `/contactLists`' `filters[updated_since]`?
   These are a different endpoint and different underlying AC field
   (`cdate`/`udate` on the contact record itself, not a list-membership
   event) — plausibly implemented differently, but this must not be
   assumed either way. `ac_recent_activity.js` used
   `filters[created_after]` successfully against this endpoint earlier
   this session (during the Campaign Report investigation), which is
   encouraging but was never adversarially tested the way the
   `updated_since` probe tested `/contactLists` — a same-style probe
   (future-dated filter, expect zero rows) should confirm it properly
   before it's load-bearing here.

A new probe script (`ac_contacts_pagination_probe.js`, same pattern as
`ac_updated_since_probe.js` in `~/Development/ac-discovery/`, run locally
by Peter) should answer all three before implementation starts.

### List-membership tradeoff — needs a decision, not just a technical answer

Switching the *discovery* loop to `/contacts` raises a real question about
*scope*: does the new design still need to touch every contact in the AC
account (including Lists 3 and 5, which are permanently excluded — List 5
specifically because it holds sensitive financial-intent data the plan
says should "never be one accidental query away" from this pipeline), or
can list-membership still be checked without ever pulling a List-3/5-only
contact's field values at all?

Two options:

- **(a) Keep `/contactLists?filters[listid]=X` as a per-contact
  membership check**, called only for contacts discovered as new via the
  `/contacts` id-cursor sweep, scoped to that one contact — preserves the
  current property that a List-3/5-only contact's detail is never fetched
  at all, at the cost of one extra AC call per newly-discovered contact.
- **(b) Rely on list membership embedded in the `/contacts` response
  itself**, if AC's contact payload includes it inline (needs checking —
  not confirmed) — fewer calls, but means every contact in the account,
  including List 3/5-only ones, briefly passes through the Edge Function's
  memory during the id-cursor sweep before being filtered out client-side
  (never persisted, same as the existing List-3/5 defense-in-depth filter
  in `sync.ts` today) — a real, if narrow, step back from "never one
  accidental query away."

**Recommend (a)** — it's the one that doesn't change the pipeline's
existing privacy posture for Lists 3/5, at a modest efficiency cost (one
membership-check call per *newly discovered* contact only, not per
already-known one, so the ongoing steady-state cost is small). Flagging
(b) because it may turn out to be unavoidable if AC's `/contacts` payload
doesn't cleanly support (a)'s per-contact scoped call — worth knowing
which before committing.

### Sketch of the new sync loop

```
registry.sync_progress: repurposed to store last_seen_ac_id (not next_offset) per list.

for each list in [1, 2]:
  cursor = getSyncProgress(list) ?? 0   # highest AC contact id fully processed
  loop, budget-limited same as today:
    page = GET /contacts?orders[id]=ASC&limit=N&offset=0   # or an id-range filter, pending verification above
    page = page.filter(c => c.id > cursor)                 # client-side cursor enforcement, safe regardless of (2)/(3) above
    if page.isEmpty: break  # caught up
    for each contact in page:
      membership = GET /contactLists?filters[listid]=list&filters[contact]=contact.id   # scoped per-contact, see option (a)
      if membership is genuinely on `list` and active:
        ...same detail fetch + staging insert as today...
      cursor = max(cursor, contact.id)
    saveSyncProgress(list, cursor)
```

Everything downstream of "a genuine, active, list-scoped membership has
been identified" (transform, field whitelist, source attribution, tag
exclusion, phone normalization) is unchanged — this redesign only touches
the discovery/pagination layer in `sync.ts`/`acClient.ts`.

## Testing plan

Same red→green discipline as every other fix this session:

1. Peter runs the new probe script against live AC, shares output.
2. Implementation in `lib/registryPipeline/sync.ts` (cursor logic — testable, framework-agnostic) and `acClient.ts` (new endpoint calls — Deno-only, verified live like today's `acClient.ts`, not unit tested, per that file's existing precedent).
3. New unit tests for the cursor logic itself: never re-processes a contact at or below the cursor even if a page returns overlapping/reordered results; cursor only advances past a contact once it's been fully processed (same partial-page-timeout safety property `sync.ts` already has today).
4. `possible_duplicate_of` logic: unit test in `transform.test.ts` — a new contact sharing an existing registrant's phone gets flagged, a genuinely new phone doesn't, an existing registrant is never modified by a later duplicate.
5. Backfill script for the 421 already-landed duplicates, run once, same pattern as the pending postcode/training-field backfill.
6. Live verification after deploy: watch `registry.registrants` actually grow again on the next few invocations (the concrete, falsifiable signal that was missing this whole time) — plus confirm no contact ID below a list's cursor is ever re-fetched.

## What this does NOT change

- Field whitelist, tag-based source attribution, MailChimp exclusion, list-status-inactive skip, phone normalization — all already correct, untouched by this proposal.
- The two safety nets added earlier this session (`MAX_CONSECUTIVE_EMPTY_MATCH_PAGES`, `MAX_OFFSET_MULTIPLIER`/`KNOWN_LIST_SIZES`) become dead code once offset-based pagination is removed — delete them as part of this change rather than leaving unreachable code behind.
- Cron scheduling (`scripts/schedule_ac_sync_cron.sql`) stays deferred until this lands and is verified against real data, same as already noted in OPERATIONS.md.
