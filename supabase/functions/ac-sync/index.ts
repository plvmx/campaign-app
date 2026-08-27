// ac-sync Edge Function — scheduled polling sync + transform, in one
// function (backfill + ongoing incremental sync; the only difference is
// which timestamp it filters from). See
// docs/registry-pipeline/AFJ_PII_Technical_Implementation_Plan.md Section 6,
// and docs/registry-pipeline/OPERATIONS.md for deploy/schedule/secrets steps.
//
// Invoked either:
//   - manually, for the pre-scheduling test run the brief's build order
//     calls for (`supabase functions invoke ac-sync`), or
//   - on a schedule, via pg_cron + pg_net (scripts/schedule_ac_sync_cron.sql).
//
// All business logic lives in lib/registryPipeline (runSync / transformPendingStagingEvents)
// and is unit-tested there under Node/Vitest — this file is only wiring:
// build the two ports (AC HTTP client, Supabase service-role client) and
// call runSync.

import { createAcClient } from './acClient.ts';
import { createDb } from './db.ts';
import { runSync } from '../../../lib/registryPipeline/sync.ts';
import { getErrorMessage } from '../../../lib/errorUtils.ts';

Deno.serve(async (_req: Request) => {
  try {
    const ac = createAcClient();
    const db = createDb();
    const result = await runSync(ac, db);
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    // Never include raw_payload or any contact field in the response —
    // this endpoint's response isn't itself locked down by RLS the way the
    // tables are, so keep it to a bare message.
    return new Response(JSON.stringify({ error: getErrorMessage(err) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});
