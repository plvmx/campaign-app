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
