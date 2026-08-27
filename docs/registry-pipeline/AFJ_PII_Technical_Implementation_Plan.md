# AFJ Registration Data Pipeline — Technical Implementation Plan

**Companion to:** AFJ PII Risk Executive Report (v3)
**Audience:** Technical implementer(s)
**Status:** Draft — for review before build begins
**Last updated:** 26 August 2026
**Organisation:** Australia For Jesus (AFJ)

---

## 1. Purpose

This document details the technical design for consolidating AFJ registration data out of ActiveCampaign (AC) and multiple manual/insecure distribution channels, into the existing Supabase project used by the CAS app — with proper isolation, access control, and audit logging.

It assumes the reader is comfortable with Supabase (Postgres, RLS, Edge Functions) and is a working companion to the executive report, not a replacement for it.

---

## 2. Architecture Overview

```
ActiveCampaign (one account, 4 Lists — see Section 3.3 for confirmed mapping)
        │
        │  Single mechanism: scheduled polling (no webhooks)
        │  Daily Edge Function pulls contacts created/updated since last run
        │  (first run acts as the full backfill)
        ▼
┌───────────────────────────────┐
│  staging schema                │
│  staging.ac_events (raw JSONB) │   ← append-only landing zone
└───────────────────────────────┘
        │  transform (same Edge Function)
        ▼
┌───────────────────────────────┐
│  registry schema (isolated)    │
│  registry.registrants          │   ← one row per person, deduped on AC contact ID
│  registry.registration_events  │   ← one row per form/list submission
│  registry.sync_log             │   ← audit trail of every ingestion run
└───────────────────────────────┘
        │  RLS-scoped views only — no raw table access
        ▼
┌───────────────────────────────┐
│  Leaders (Supabase Auth,       │
│  magic-link, MFA for high-     │
│  privilege roles)              │
└───────────────────────────────┘
        │
        ▼
  WhatsApp onboarding (mechanism pending platform decision — see Executive Report 3.4)
```

Key principle throughout: **no client (browser) ever talks to `registry.*` tables directly.** All reads go through views or RPC functions; all writes go through Edge Functions using the service role key, which never leaves the server side.

**Change from earlier drafts:** webhooks have been dropped in favour of scheduled polling, since near-real-time updates aren't required and polling needs no further configuration from the AC admin. This also collapses what were previously three separate mechanisms (backfill, webhook, reconciliation) into one: a single incremental-pull job that runs on every schedule, using a stored cursor timestamp.

---

## 3. Source: ActiveCampaign

### 3.1 Confirmed account structure

Discovery via a read-only script against `/api/3/lists` and `/api/3/fields` (see Appendix A) confirmed **one AC account with 4 Lists** — not multiple accounts. AC's own contact model deduplicates by email, so a person submitting two different forms resolves to **one Contact record** with multiple list memberships. This is the assumption the schema in Section 5 is built on.

### 3.2 Credentials handling — shared, full-access, non-rotatable key

The API key provided is **not** a temporary/scoped credential as originally planned — it is AFJ's existing, full-access, account-wide key, already used by other integrations that write data into AC. AFJ has confirmed it will not be rotated or regenerated to avoid breaking those integrations. This changes credential handling as follows:

- Stored in Supabase Edge Function secrets only; never in client code, logs, or error messages.
- Access to that secret restricted to the minimum number of Supabase project admins.
- Code deliberately calls only read endpoints (`/lists`, `/fields`, `/contacts`) even though the key permits more — self-imposed least privilege, since AC won't enforce it.
- **Rate limit awareness:** AC enforces 5 requests/second **per account**, shared across every integration using this account, not per-key. The polling job must pace requests conservatively (small delay between calls, exponential backoff on HTTP 429 using the `Retry-After` header) to avoid starving other integrations of their share — this matters most during the initial full pull, since incremental daily pulls should be small.
- Because rotation isn't unilaterally available, document (outside AC) that this key is shared, so any future suspected compromise triggers coordination with whoever owns the other integrations rather than an independent revoke.

### 3.3 Confirmed Lists, tags, and field mapping (verified via live test submissions)

**Methodology:** rather than relying on tab names or field-name matching, each live page was tested with a real, identifiable submission and inspected via `ac_contact_lookup.js` (Appendix A). This overturned several name-based assumptions — documented below as corrections, not just findings.

| Source page | List | Source-identifying tag | Status |
|---|---|---|---|
| `/register/` (Main AFJ page) | `[1]` | `[21] ACTION: Australia For Jesus Commitment` | **Confirmed via test submission** |
| `/thewayoflife/` | `[1]` | `[48] CAMPAIGN: TWOL Sept 2019 Register` | **Confirmed via test submission** — corrects earlier guess of List 2 |
| BOTJ (`bringingotherstojesus.com.au` → Typeform) | `[1]` | `[58] CAMPAIGN: Bringing Others Webinar: Registered` | **Confirmed via test submission** — external Typeform integration, not an AC-native form |
| `/wayoflife-responder/` | `[2]` | `[1] FORM: Way of life responder: Completed` | **Confirmed via test submission** |
| `[3] Business Life` (173 contacts) | — | `LOCATION: <city>` tags, sparse field data | **Investigated, excluded from scope** — see 3.6 |
| `[5] Tony Mclennan` (5 contacts) | — | Unknown | **Unresolved, excluded from scope** — low volume, low priority |
| *(not a List)* Campaign Reports | — | — | Not traced to a live page; likely not a registrant-facing source |
| *(not a List)* Unsubscribes | — | — | Per-contact/per-list status, not a distinct source |

**Critical architecture correction:** List `[1]` is a de facto catch-all for three of the four live registration funnels. **List membership alone cannot distinguish which page a registrant came through** — the tag is the only reliable source-identifier. The ingestion transform must capture and match against tags, not rely on List ID for source attribution. Tag naming is inconsistent across pages (`ACTION:`, `CAMPAIGN:`, `FORM:` prefixes all in use) — match against the known tag ID list, not a naming pattern.

### 3.4 Confirmed field mapping (corrects earlier assumptions)

| Field | Decision | Evidence / reason |
|---|---|---|
| Standard contact fields (name, email, phone) | **Include** | Core to registry purpose |
| `[6] State` (free text) | **Include — canonical source** | **Correction:** confirmed populated on all 3 tested List-1 pages; `AU State [25]` dropdown was never populated on any test submission — treat as unused/legacy, not canonical |
| `[25] AU State` (dropdown) | **Include as fallback only** | Reversed from earlier assumption — see above |
| `[9] Interested in training?` | **Include** | Confirmed live and populated (`/register/` test); "hidden" field type does not mean staff-only — it was populated directly by the public form |
| Postcode (visible on `/register/` and `/thewayoflife/` pages) | **Not currently capturable — data loss identified** | Field is shown and marked required on the page, but does not appear anywhere in the contact record after submission (confirmed via 2 separate test submissions). Not an AC field mapping issue — the data appears to be lost between the page and AC entirely. See 3.5. |
| `[10]` / `[28]` Church Leader? | **Exclude** | Sensitive-adjacent; leadership decision |
| `[15]` Denomination | **Exclude** | Sensitive information (religious affiliation) under Australian Privacy Principles |
| `[4]` Did they say the response prayer? | **Exclude** | Sensitive information (religious affiliation) |
| `[12]` How much would you like to give? | **Exclude** | Sensitive information (financial intent) |
| `[13]` How can you support AFJ? | **Exclude** | Adjacent to financial intent |
| `[14]` Church Name / `[26]` What Church do you attend? | **Exclude** | Confirmed by AFJ leadership |
| `[20]` Music Leader, `[21]` Website, `[29]` Webinar Replay Link | **Exclude** | Not needed for stated purposes |
| `[8]` Church, `[11]` Country | **Exclude by default** | No confirmed operational need identified |
| `[23]` BOTJ Webinar Rego Date, `[24]` BOTJ Webinar Session | **Include** | Confirmed live via BOTJ test submission; useful for campaign scheduling |
| Response-outcome fields (`[4]`/`[5]` equivalents on wayoflife-responder) | **Exclude** | Sensitive information, consistent with the exclusion decision above |

Excluded fields remain in ActiveCampaign only and are never queried by the ingestion job — enforced in `map_ac_fields()` (Section 6.2), not just by convention.

### 3.5 Data quality issues confirmed via testing

- **Postcode data loss (definitively confirmed):** the page-level Postcode field does not reach AC on either page that shows it. Confirmed via full raw-contact-record inspection (not just custom field values) on both pages' test contacts, including AC's own explicit confirmation that no address relationship exists for either contact (`"Subscriber has no relationship definition for addresses"`). This rules out the field landing anywhere else in the record. Root cause is on the landing-page side (likely "Thrive Digital," based on form configuration metadata), not AC — worth raising directly with them rather than the AC admin, who has no ability to fix a page-build issue.
- **Phone number format is inconsistent across sources** — three distinct formats observed across four test submissions (`+61438438438`, `0438438438`, `0438 438 438`). The transform step must normalize to a single consistent international format before this data is used for WhatsApp invite automation, which requires a consistent format to function reliably.
- **Duplicate encoding of the same data as both a field and a tag** — State appears as both the `State` field and a `STATE: <state>` tag; response-prayer outcomes similarly appear as both a field and a tag on `/wayoflife-responder/`. The field remains the canonical source; tags are a secondary/redundant encoding likely used by AC's own automations, not something the registry needs to also capture.

### 3.6 List 3 ("Business Life") and List 5 ("Tony Mclennan") — investigated and excluded from initial scope

A privacy-minimizing sample of List 3 (5 contacts, field/tag presence only — no PII values retrieved, via `ac_list_sniff.js`, Appendix A) showed sparse core-field completion (1/5 with `State`, 2/5 with a phone number) and heavy reliance on `LOCATION: <city>` and `ACTION: Completed video series` tags. This is more consistent with a marketing/content-engagement segmentation list (e.g. driven by ad-platform integration or CSV import) than a self-service registration funnel, and its data sparsity makes it of limited operational use for campaign scheduling or WhatsApp onboarding regardless of its exact origin.

**Recommendation:** exclude Lists 3 and 5 from the initial ingestion scope. Revisit only if a genuine operational need for their data emerges — at 173 and 5 contacts respectively, the cost of continued investigation outweighs the currently-apparent benefit.

---

## 4. Staging Layer

Purpose: a faithful, untransformed landing zone so a malformed or unexpected payload from any one source never corrupts clean data.

```sql
create schema if not exists staging;

create table staging.ac_events (
    id              bigint generated always as identity primary key,
    source_list_id  text not null,        -- which AC list/form this came from
    ac_contact_id   text,                 -- AC's own contact ID, if present in payload
    event_type      text not null,        -- 'backfill' | 'webhook' | 'reconciliation'
    raw_payload     jsonb not null,       -- untouched payload as received
    received_at     timestamptz not null default now(),
    processed_at    timestamptz,          -- null until transform step has run
    processing_error text                 -- populated if transform failed
);

create index on staging.ac_events (processed_at) where processed_at is null;
create index on staging.ac_events (ac_contact_id);
```

Nothing is deduplicated or cleaned here — every event, including duplicates across sources, lands as its own row. Deduplication happens in the transform step.

---

## 5. Canonical Schema

```sql
create schema if not exists registry;

-- One row per real person, deduped on AC contact ID
create table registry.registrants (
    id              uuid primary key default gen_random_uuid(),
    ac_contact_id   text unique not null,
    full_name       text,
    email           text,
    phone           text,               -- normalized E.164 format, see 6.2
    phone_raw       text,               -- original as received, kept for audit/debugging
    state           text,               -- from field [6] State (free text) — confirmed canonical, see 3.4
    first_seen_at   timestamptz not null default now(),
    last_updated_at timestamptz not null default now()
);

-- One row per form/list submission — many-to-one against registrants
create table registry.registration_events (
    id              bigint generated always as identity primary key,
    registrant_id   uuid not null references registry.registrants(id),
    source_list_id  text not null,
    source_tag      text,                 -- the AC tag that actually identifies the source page,
                                           -- e.g. 'CAMPAIGN: TWOL Sept 2019 Register' — see 3.3.
                                           -- List ID alone is NOT sufficient for source attribution.
    event_type      text not null,       -- 'new_registration' | 'field_update' | ...
    occurred_at     timestamptz not null default now(),
    raw_staging_id  bigint references staging.ac_events(id)
);

-- Lookup table mapping known AC tag IDs to a human-readable source label —
-- populated from the confirmed tag map in Section 3.3, extended as new
-- sources are identified.
create table registry.known_source_tags (
    ac_tag_id       text primary key,
    tag_name        text not null,
    source_label    text not null    -- e.g. 'register_page', 'wayoflife_interest', 'botj_webinar', 'wayoflife_responder'
);

-- Audit trail of every ingestion run
create table registry.sync_log (
    id              bigint generated always as identity primary key,
    run_type        text not null,       -- 'sync' | 'export'
    started_at      timestamptz not null default now(),
    completed_at    timestamptz,
    records_in      integer,
    records_upserted integer,
    errors          integer,
    notes           text
);

revoke all on registry.registrants, registry.registration_events, registry.known_source_tags from anon, authenticated;
revoke all on staging.ac_events from anon, authenticated;
-- Only the service role (used exclusively by Edge Functions) can touch these directly.
```

`sync_log` is what gives you the audit trail the current CSV/email process completely lacks — every ingestion run, successful or not, is recorded.

---

## 6. Ingestion Logic

Single mechanism: a scheduled Edge Function, run daily (or more frequently if latency needs later prove tighter than expected) via Supabase Cron / `pg_cron`. No webhook receiver is built. The same function handles the first-ever full pull and every incremental pull after it — the only difference is what timestamp it filters from.

### 6.1 Scheduled sync (backfill + ongoing, one function)

```
function runSync():
    log = insert into registry.sync_log (run_type='sync', started_at=now())
    last_sync = select max(completed_at) from registry.sync_log where run_type='sync'
                and completed_at is not null
    # null on first-ever run — AC.getContacts below then pulls everything

    cursor = null
    total_in = 0

    loop:
        page = AC.getContacts(
            limit = 100,                      # AC paginates at 100/request max
            id_greater = cursor,
            updated_since = last_sync         # omitted entirely on first run
        )
        if page is empty: break

        for contact in page:
            if contact.list_id not in ['1', '2']:   # Lists 3 and 5 explicitly excluded — see 3.6
                continue

            insert into staging.ac_events (
                source_list_id = contact.list_id,
                ac_contact_id  = contact.id,
                event_type     = (last_sync is null) ? 'backfill' : 'sync',
                raw_payload    = contact.raw_json
            )
            total_in += 1

        cursor = page.last.id
        sleep(250ms)   # pace against the shared 5 req/sec account-wide rate limit

    transform_pending_staging_events()   # see 6.2
    update sync_log set completed_at=now(), records_in=total_in, ...
```

**Notes:**
- `updated_since` uses AC's contact-updated-timestamp filter. This field has been reported as occasionally unreliable in community discussion — verify against real data early (e.g. update a test contact, confirm it's picked up on the next run) and fall back to a created-date filter plus periodic full re-sync if it doesn't behave as expected.
- The `sleep(250ms)` pacing is deliberate given the shared, non-scoped API key (Section 3.2) — keeps this job well under the account-wide 5 req/sec ceiling even during a large pull, leaving headroom for the other integrations using the same key.
- On a 429 response, back off using the `Retry-After` header rather than a fixed delay.
- **List exclusion is enforced here, not just as a policy decision.** A contact belonging to List 3 or 5 is skipped before it ever reaches staging — this is deliberate defense-in-depth given List 5 contacts include sensitive financial-intent data (`How much would you like to give?`), so it should never be one accidental query away from entering the registry. If a contact is on List 1 *and* List 3/5 simultaneously, AC's `contact.list_id` in a single event payload reflects one list per event — worth confirming during build whether multi-list contacts generate one event per list membership, and excluding only the List 3/5-attributed event rather than the whole contact.

### 6.2 Transform step

```
function transform_pending_staging_events():
    events = select * from staging.ac_events where processed_at is null
    known_tags = select * from registry.known_source_tags   # cached, refreshed periodically

    for event in events:
        try:
            # List-status check: confirmed via real test data that contactLists
            # status can be values other than '1' (e.g. '3', seen on a bounced
            # test email) — skip anything not actively subscribed rather than
            # assuming every list-membership record means an active registrant.
            if event.raw_payload.contact_list_status != '1':
                update staging.ac_events set processed_at = now(),
                    processing_error = 'skipped: list status not active' where id = event.id
                continue

            fields = map_ac_fields(event.raw_payload)   # name, email, phone_raw, state — see fields
                                                          # confirmed in 3.4; never reads excluded field IDs

            phone_normalized = normalize_phone(fields.phone_raw)  # see below

            registrant = upsert into registry.registrants (
                ac_contact_id = event.ac_contact_id,
                full_name = fields.name,
                email = fields.email,
                phone = phone_normalized,
                phone_raw = fields.phone_raw,
                state = fields.state,          # from field [6] State — confirmed canonical, not AU State [25]
                last_updated_at = now()
            )
            on conflict (ac_contact_id) do update set ...

            # Source attribution: match the contact's tags against known_source_tags,
            # NOT source_list_id — List 1 is a catch-all for 3 of 4 confirmed sources
            # and cannot distinguish between them on its own (see 3.3).
            matched_tag = event.raw_payload.tags.find(t => t.id in known_tags)

            insert into registry.registration_events (
                registrant_id  = registrant.id,
                source_list_id = event.source_list_id,
                source_tag     = matched_tag ? matched_tag.name : null,
                event_type     = 'new_registration',
                raw_staging_id = event.id
            )

            update staging.ac_events set processed_at = now() where id = event.id

        except error:
            update staging.ac_events set processing_error = error.message where id = event.id


function normalize_phone(raw):
    # Confirmed via testing: raw values arrive in at least 3 different formats
    # ('+61438438438', '0438438438', '0438 438 438') — normalize all to E.164
    # before this data is used for WhatsApp invite automation, which requires
    # a consistent format to function reliably.
    digits = strip_non_digits(raw)
    if digits.startsWith('61'): return '+' + digits
    if digits.startsWith('0'):  return '+61' + digits.substring(1)
    return '+61' + digits   # fallback assumption — flag for manual review if ambiguous
```

**Note on Postcode:** no transform logic exists for it, deliberately — definitively confirmed absent from both the AC contact record and any address relationship. This isn't a mapping gap in this pipeline; it's a data-loss issue upstream of AC, on the landing-page side. See Section 3.5.

This is the step that handles the "same person, multiple forms" case: the `upsert ... on conflict (ac_contact_id)` means a second submission updates the existing `registrants` row rather than creating a duplicate person, while still recording a distinct `registration_events` row for that submission.

`map_ac_fields()` is also where the field-inclusion decisions from Section 3.3 are enforced in code — it should only ever read the included fields (name, email, phone, `State [6]` as canonical with `AU State [25]` as fallback only, and any confirmed operational fields like training interest) and must never reference the excluded field IDs at all, so a future accidental change to AC's forms can't silently reintroduce sensitive data into the pipeline.

### 6.3 Latency note

Since this is polling rather than event-driven, a new registrant won't appear in `registry.registrants` — and won't trigger any downstream WhatsApp onboarding step — until the next scheduled run. Confirm this delay (daily, by default) is acceptable for all use cases; if any scenario needs same-day visibility, increase the schedule frequency rather than reintroducing webhooks.

---

## 7. Access Layer (Phase 1 parallel / Phase 2)

### 7.1 Leader authentication

- Supabase Auth, magic-link (email OTP) — no passwords for volunteers to manage or reuse.
- A `registry.leader_roles` table maps `auth.uid()` to a role and state scope:

```sql
create table registry.leader_roles (
    user_id     uuid primary key references auth.users(id),
    role        text not null check (role in ('state_leader','national_admin','whatsapp_admin')),
    state       text,          -- null for national_admin / whatsapp_admin
    mfa_required boolean not null default false
);
```

- `national_admin` and `whatsapp_admin` rows set `mfa_required = true`; enforce via Supabase Auth's MFA settings for those users.

### 7.2 RLS-scoped views

No leader queries `registry.registrants` directly. Instead:

```sql
create view registry.v_leader_registrants as
select r.id, r.full_name, r.email, r.phone, r.state
from registry.registrants r
join registry.leader_roles lr on lr.user_id = auth.uid()
where lr.role = 'national_admin'
   or (lr.role = 'state_leader' and lr.state = r.state);

grant select on registry.v_leader_registrants to authenticated;
```

This is the mechanism that replaces the live spreadsheet: a leader's login determines exactly which rows they see, automatically, with no manual collation and a built-in audit trail (Postgres/Supabase query logs) of who accessed what.

### 7.3 Controlled export (if a CSV is genuinely needed)

If a leader needs an offline export for a meeting, provide a logged RPC function rather than raw table access:

```sql
create function registry.export_my_registrants()
returns setof registry.v_leader_registrants
language plpgsql
security definer
as $$
begin
    insert into registry.sync_log (run_type='export', notes=auth.uid()::text, started_at=now(), completed_at=now());
    return query select * from registry.v_leader_registrants;
end;
$$;
```

Every export is now a logged event, unlike the current spreadsheet download.

---

## 8. WhatsApp Onboarding Change — design pending platform decision

**Status: blocked on a leadership decision, not a technical one.** AFJ's actual footprint (~100 groups, 9,000+ subscribers) exceeds published limits for a single WhatsApp Community under every currently available figure — see Executive Report Section 3.4. The mechanism below assumes a state-based invite-link model; it will need revisiting once that decision is made (federated multi-Community structure, vs. an alternative platform).

Design, pending confirmation:

1. On new row in `registry.registration_events`, an Edge Function trigger fires.
2. Function looks up the correct invite link(s) for the registrant's state (and city/regional group if applicable), stored in a small config table, updated whenever a link is reset.
3. Sends the invite link(s) to the registrant via Resend (email) or Twilio (SMS) — reusing existing AFJ infrastructure.
4. Groups have **"Approve new members"** enabled, so an admin still has a checkpoint before someone joins, without ever needing to save their number as a contact.

```sql
create table registry.whatsapp_group_links (
    group_key   text primary key,   -- e.g. state code, or state+city if applicable
    group_level text not null,      -- 'national' | 'state' | 'city'
    invite_url  text not null,
    updated_at  timestamptz not null default now()
);
```

This schema is deliberately generic (`group_key`/`group_level` rather than a fixed `state` column) so it can accommodate either outcome of the platform decision without a redesign.

---

## 9. Sequencing Summary

| Stage | Depends on | Can start now? |
|---|---|---|
| Staging + canonical schema | — | Yes |
| Scheduled sync (backfill + ongoing) | AC credentials (already provided) | Yes |
| Field mapping / exclusion logic | Live test-submission verification | **Complete** — all List/field/tag mapping confirmed via Section 3.3–3.4 |
| Leader Supabase Auth rollout | — | Yes, in parallel with above |
| RLS-scoped views | Auth rollout complete | No — blocked until auth is live |
| WhatsApp invite-link automation | Platform decision (Section 8) + registration_events populated | No — blocked on leadership decision |

The two hard dependencies: **no leader-facing read access until Supabase Auth rollout is complete**, and **no WhatsApp automation until the platform/scale decision is made**. Everything else (schema, sync, transform logic for confirmed fields) can be built immediately.

---

## 10. Open Implementation Questions

All List/field/tag mapping questions from earlier drafts have now been resolved via live test-submission verification (Section 3.3–3.4). Remaining items:

- **Postcode data loss — resolved as a finding, action remains open.** Definitively confirmed missing (Section 3.5); decide whether to raise with Thrive Digital to fix, or accept state-level granularity only for WhatsApp city/regional group assignment.
- **List membership status handling** — real test data showed `contactLists` status values other than `1` (e.g. `3`, associated with a bounced test email). The transform logic (Section 6.2) currently assumes status `1` = active without an explicit check; add one so a bounced/unsubscribed contact isn't silently treated as an active registrant.
- **BOTJ/Typeform integration ownership** — confirmed working, but the actual Typeform→AC connection (Zapier or native integration) lives outside AC entirely and hasn't been inspected. Worth identifying who manages it, in case it ever needs troubleshooting or the connected fields change.
- Verify AC's `updated_since` contact filter behaves reliably against real data (Section 6.1 note) before relying on it for incremental sync.
- Decide retention policy for `staging.ac_events` — raw payloads could be purged after successful processing (e.g. 30 days).
- WhatsApp platform decision (Section 8) — still blocks the invite-link automation build entirely until resolved.
- Confirm whether Lists 3 and 5 should remain excluded long-term, or be revisited if an operational need emerges (Section 3.6).

---

## Appendix A: AC Discovery Toolkit

Three read-only scripts were used to build the confirmed mapping in Section 3, in place of continued reliance on the AC admin (whose availability is limited):

- **`ac_discovery.js`** — enumerates Lists, Fields, field-list relationships, Forms, Tags, per-list contact counts, and Automations. Fully account-level, no contact PII touched.
- **`ac_contact_lookup.js`** — given a test contact's email, prints exactly which List, fields, and tags a real submission produced. Used to verify every live page against ground truth rather than name-based inference.
- **`ac_list_sniff.js`** — for lists holding genuine member data (not test contacts), reports which fields/tags are populated across a small sample **without ever printing actual PII values** — used to characterize List 3 without over-exposing real member data.

Rerun these if AC's form structure changes, or if List 3/5 are revisited later.
