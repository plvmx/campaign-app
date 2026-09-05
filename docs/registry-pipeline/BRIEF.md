# BRIEF: AFJ Registry Pipeline — Build Session

## Objective

Build the AC → Supabase registration data pipeline, in the same Supabase project as the CAS app, per `docs/registry-pipeline/technical-plan.md` (read that first — this brief scopes the session, the technical plan has the schema/pseudocode detail).

## Scope for this session

**In scope — build now:**
- `staging` and `registry` schemas (migration)
- Scheduled polling Edge Function (`ac-sync`): backfill + ongoing incremental sync in one function, per Section 6 of the technical plan
- Transform logic: field mapping, tag-based source attribution, phone normalisation, list-status filtering, explicit exclusion of Lists 3 & 5
- Supabase Auth (magic-link) rollout for leaders, `registry.leader_roles` table
- MFA enforcement for `national_admin` / `whatsapp_admin` roles

**Explicitly out of scope for this session — do not build:**
- WhatsApp invite-link automation (blocked on the platform/scale decision — see executive report Section 3.4)
- RLS-scoped leader-facing views (blocked until auth rollout above is live and tested)
- Anything using the AC "Postcode" field — confirmed not present in AC data, pending Thrive Digital response. Do not add a postcode column or field mapping yet.

## Key decisions already made (do not re-litigate)

- **One Supabase project, isolated schema** — not a separate project. See technical plan Section 2.
- **Polling, not webhooks** — a single scheduled Edge Function handles both backfill and ongoing sync via an incremental `updated_since` cursor.
- **AC credential is shared, full-access, non-rotatable** — store in Edge Function secrets only; code must only call read endpoints even though the key permits more; pace requests against the shared account-wide 5 req/sec limit (small delay + backoff on 429).
- **Field inclusion/exclusion is final**, confirmed by AFJ leadership: religious belief/affiliation, financial-intent, and church name/attendance fields are excluded entirely and must never be read by `map_ac_fields()`. See technical plan Section 3.4 for the full table.
- **Source attribution is tag-based, not List-based.** List 1 is a catch-all for 3 of 4 live registration sources; the actual source is determined by matching a contact's tags against a known set (`registry.known_source_tags` — see technical plan Section 3.4 for the confirmed tag map: IDs 21, 48, 58, 1).
- **`State [6]` is the canonical state field**, not `AU State [25]` (confirmed via live test data — the dropdown field is unused in practice).
- **Lists 3 (Business Life) and 5 (Tony Mclennan) are permanently excluded** — confirmed via privacy-minimising sampling to be unrelated programs / a manually curated internal list containing sensitive data. Filter these out at the sync step, not just in the transform — see technical plan Section 6.1 for the explicit exclusion logic.
- **Phone numbers arrive in inconsistent formats** (confirmed via testing: `+61...`, `0...`, spaced) — normalise in the transform step, don't assume a consistent shape.
- **List membership status must be checked** — `contactLists` status can be non-active (e.g. bounced), confirmed via real test data. Skip anything not status `1`.

## Suggested build order

1. Migration: `staging.ac_events`, `registry.registrants`, `registry.registration_events`, `registry.sync_log`, `registry.known_source_tags`
2. `ac-sync` Edge Function: sync logic (6.1) → transform (6.2), tested against a manual invocation before scheduling
3. Schedule via `pg_cron` (start daily; revisit frequency if latency proves an issue)
4. `registry.leader_roles` table + Supabase Auth magic-link rollout
5. MFA enforcement for high-privilege roles

## Reference documents (copy into `docs/registry-pipeline/` if not already there)

- `technical-plan.md` — full schema, pseudocode, field/tag mapping tables
- `executive-report.docx` — leadership-facing context, risk register, open decisions (WhatsApp platform, Lists 3/5 sign-off)
