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

**Recommendation: surface phone-collisions for a human to review, never
silently merge two `ac_contact_id`s into one identity automatically.**
Peter confirmed (2026-09-01) Lorraine — already a full admin
(`state_leaders.admin = 'AD'`) and one of the few people who will have
admin access once this data is exposed — is best placed to make that
call, so this now includes a dedicated review screen rather than just a
queryable column.

A shared phone number is suggestive, not proof — a couple, a family, or a
shared church-office phone can legitimately produce this pattern for two
*different* real people. Auto-merging risks silently losing or
misattributing one person's data, which is a worse failure mode than
leaving a duplicate for a human to resolve.

### Schema: a proper flag table, not just a pointer column

A single nullable pointer column can't carry a resolution status or an
audit trail, both of which the review screen needs — a join table
matching this app's existing pattern for a reviewable queue (e.g.
`campaign_interest`'s `contacted`/`contacted_at`) is a better fit:

```sql
CREATE TABLE registry.registrant_duplicate_flags (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  registrant_id            UUID NOT NULL REFERENCES registry.registrants(id),  -- the newer of the pair, flagged at creation time
  matched_registrant_id    UUID NOT NULL REFERENCES registry.registrants(id),  -- the existing registrant it matched against
  match_reason             TEXT NOT NULL,             -- 'phone' today; extensible if another match strategy is ever added
  status                   TEXT NOT NULL DEFAULT 'pending',  -- 'pending' | 'confirmed_duplicate' | 'not_duplicate'
  canonical_registrant_id  UUID REFERENCES registry.registrants(id),  -- set only when status = 'confirmed_duplicate'
  resolved_by              TEXT,                       -- the resolving admin's identifier (leader name/mobile, matching this app's existing login model)
  resolved_at              TIMESTAMP WITH TIME ZONE,
  created_at               TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE (registrant_id, matched_registrant_id)
);
```

Deliberately does **not** delete or merge either registrant row, even once
confirmed as a duplicate — both keep syncing independently from AC exactly
as today (each still has its own real, distinct `ac_contact_id`). This
table only records the *relationship* and Lorraine's *decision* about it;
`canonical_registrant_id` marks which one to prefer for anything
person-facing later (e.g. a single WhatsApp invite per real person), it
doesn't discard the other.

- Populated automatically in `transform.ts`: before `upsertRegistrant` for
  a genuinely new `ac_contact_id`, look up any *existing* registrant
  sharing the same normalized phone; if found, insert a `pending` row here
  (never touches or overwrites the existing registrant).
- Runs going forward on every new contact automatically; a **one-time
  backfill script** (same pattern as the postcode/training backfill
  already flagged as a known follow-up) does the same check across the
  421 already-landed rows to populate the initial review queue.

### Admin screen: `/admin/registry-duplicates`

New page, following this app's existing conventions rather than inventing
new ones — with one important exception to "existing conventions",
addressed below.

**A genuinely new precedent, and a real auth-sequencing decision, not just
a data-access one:** every other `/admin/*` page reads its data through a
`lib/services/*` module on the *browser* Supabase client, gated by the
old mobile+name login's `adminStatus === 'AD'` check. `registry.*` tables
are RLS-enabled with **no policies** plus an explicit `REVOKE ALL FROM
anon, authenticated` — by design, only the service role has ever touched
them, exclusively from the Edge Function. This screen would be the
**first place the main Next.js app reads or writes `registry.*` data at
all**, and the first admin-only PII-resolution UI in the app.

Peter has flagged that full Supabase Auth with MFA is coming, specifically
for admins — and `registry.leader_roles` (already built, currently unused
— see its own comment: "enforcement is in place at the database level but
has nothing yet to gate") already models exactly this: `auth.uid()` →
role/state scope, with `national_admin`/`whatsapp_admin` roles that are
MFA-required via `registry.has_required_mfa()`. That scaffolding exists
specifically for high-privilege access to this exact kind of registry
data — this screen is the natural first thing for it to actually gate,
rather than reusing the old mobile+name check the way
`app/api/admin/settings/route.ts` does for the main app's own tables.

Two real options, not a default to just pick:

- **(a) Build now on the old mobile+name admin check** (same pattern as
  `app/api/admin/settings/route.ts`: Bearer token →
  `supabaseAdmin.auth.getUser()` → `user_profiles` → `state_leaders` →
  `admin === 'AD'`). Fastest to ship — duplicates are already accumulating
  (421 and counting) — but it's a stopgap: this screen would need its
  auth check torn out and rebuilt once the MFA rollout lands, and in the
  meantime the most sensitive new PII-resolution surface in the app runs
  without the MFA protection Peter specifically wants for admin access to
  this data.
- **(b) Gate it on `registry.leader_roles` + Supabase Auth from the
  start** — the first real consumer of that already-built scaffolding.
  Correctly matches the sensitivity of what this screen does from day
  one, no throwaway auth code later. Costs more up front: needs at least
  a minimal slice of the magic-link login flow working end-to-end for
  Lorraine specifically (not the full leader-facing rollout BRIEF.md
  defers elsewhere — just enough for one `national_admin` to log in and
  be recognized), which BRIEF.md currently scopes as a separate, larger
  piece of work.

**Recommend (b)** given Peter's own framing (MFA "especially for admins",
and this is precisely an admin-only PII-resolution surface) — but this is
Peter's call given the real cost difference, not a default I should just
build. **Not building either until this is confirmed.**

- `GET /api/admin/registry-duplicates?status=pending` — list flagged
  pairs, each with both registrants' key fields joined (name, email,
  phone, state, postcode, church, church leader?, interested in training?,
  source tag, first seen date, `ac_contact_id`).
- `POST /api/admin/registry-duplicates/[id]/resolve` — body
  `{ status: 'confirmed_duplicate' | 'not_duplicate', canonicalRegistrantId?: string }`;
  sets `resolved_by`/`resolved_at` server-side from the verified caller,
  never trusts a client-supplied resolver identity.

**Page layout**, following `CampaignInterestEntryList.tsx`'s existing
pattern of a shared row-list component plus a per-row action:

- A queue of pending flags, most recent first, with a "N pending" count
  badge (same visual language as the existing "N people interested"
  callout on `CampaignCard`).
- Selecting a flagged pair shows both registrants **side by side** —
  every shared field in one row per field, with differing values visually
  highlighted (the *same* fields, like the shared phone that triggered the
  match, should read as identical at a glance; the fields most likely to
  actually help her judge — different emails, different postcodes,
  different source tags, how far apart their `first_seen_at` dates are —
  should stand out).
- Three actions per pair:
  1. **"Same person"** — prompts which of the two to treat as canonical
     (radio choice between the two columns), then resolves as
     `confirmed_duplicate`.
  2. **"Different people"** — one click, resolves as `not_duplicate`, both
     remain fully independent, this exact pair is never resurfaced again.
  3. **"Skip for now"** — moves to the next pair without resolving,
     leaves it `pending`.
- A secondary "Resolved" tab/filter for auditing past decisions —
  reachable, not the default view, so the queue itself always opens on
  what's actually actionable.

**Open questions for Peter** — before building:

1. Should a `pending` (unreviewed) duplicate still receive its own
   independent WhatsApp invite / follow-up contact later (when that phase
   is built), or should anything with an unresolved flag be excluded from
   contact-facing features until Lorraine clears it? Affects how urgently
   the queue needs to be worked through once live, not the screen's
   design itself.
2. `resolved_by` needs a caller identity either way — under option (a)
   that's the leader's *name* (from `UserContext`, matching how other
   admin actions in this app are attributed today); under option (b) it's
   `auth.uid()` itself, resolvable to a name via `registry.leader_roles`.
   Settled once the (a)/(b) choice above is.

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

### Open questions — status after the live probe (2026-09-01)

Every `/contactLists` filter tried so far turned out broken, so nothing
about `/contacts` was assumed to work differently without the same kind
of test used to catch the others. `ac_contacts_pagination_probe.js`
(`~/Development/ac-discovery/`, same pattern as `ac_updated_since_probe.js`)
answered these against live AC data — see OPERATIONS.md for the full
write-up:

1. ~~Does `/contacts` support `orders[id]=ASC`?~~ **Confirmed yes** — and
   separately, the same page fetched twice 8 seconds apart returned
   identical contact IDs in identical order: pagination is genuinely
   stable, not just orderable.
2. Genuine `id`-range filter (`filters[id_greater]` or similar) — not
   directly tested; superseded by finding #3 below, which gives a cleaner
   incremental mechanism than an id-range filter would have anyway.
3. ~~Does `filters[created_after]`/`filters[updated_after]` actually
   filter?~~ **`created_after` confirmed working** — a future-dated filter
   correctly returned zero rows, the first AC filter of any kind in this
   whole project to pass that test. **`filters[updated_after]` not yet
   tested** — `created_after` alone would miss an existing AC contact who
   joins List 1/2 later (their `cdate` doesn't change), so this needs its
   own independent confirmation before being load-bearing — same
   discipline that caught the others; the probe script has been extended
   to test it, rerun pending.

### List-membership tradeoff — resolved by the probe, not just a recommendation anymore

Switching the *discovery* loop to `/contacts` raised a real question about
*scope*: does the new design still need to touch every contact in the AC
account (including Lists 3 and 5, which are permanently excluded — List 5
specifically because it holds sensitive financial-intent data the plan
says should "never be one accidental query away" from this pipeline), or
can list-membership still be checked without ever pulling a List-3/5-only
contact's field values at all?

The probe checked a real `/contacts` payload's full top-level key set —
**no list-membership data is embedded at all.** That settles it: option
(a), a scoped `/contactLists?filters[listid]=X` check called only for
contacts discovered as new via the `/contacts` id-cursor sweep, is the
only viable approach, not a preference — preserves the existing property
that a List-3/5-only contact's detail is never fetched at all, at the
cost of one extra AC call per newly-discovered contact (not per
already-known one, so the ongoing steady-state cost is small).

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
