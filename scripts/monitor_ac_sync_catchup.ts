/**
 * Long-running watcher for the post-reload ac-sync catch-up (see
 * docs/registry-pipeline/OPERATIONS.md's "Backlog size measured, stale
 * cursor bug found and fixed, cron temporarily sped up" entry). Polls
 * registry.sync_log / registry.sync_progress every 2 minutes and prints a
 * line only on a notable state change:
 *   - genuine completion (a real status='success' sync_log row, started
 *     after the cursor reset — the actual signal the 3,496-contact backlog
 *     is fully drained)
 *   - errors appearing on the latest run
 *   - the offset going stale (no advance across 3 consecutive polls, i.e.
 *     ~6 minutes — longer than the 5-minute cron cadence, so a genuine
 *     stall, not just bad luck on timing)
 * Exits only on completion or a hard read error; kept running otherwise.
 * Not part of the app — a one-off operational script.
 */
import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';

const envPath = path.join(__dirname, '..', '.env.local');
fs.readFileSync(envPath, 'utf-8').split('\n').forEach((line) => {
  const t = line.trim();
  if (!t || t.startsWith('#')) return;
  const [k, ...rest] = t.split('=');
  if (k && rest.length) process.env[k.trim()] = rest.join('=').trim().replace(/^["']|["']$/g, '');
});

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

const POLL_MS = 120_000;
const RESET_CUTOFF = '2026-09-09T11:26:00Z'; // just before the first post-reset invocation

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function poll() {
  const { data: latestRows, error: logError } = await supabase
    .schema('registry')
    .from('sync_log')
    .select('id, started_at, completed_at, status, records_in, records_upserted, errors')
    .order('started_at', { ascending: false })
    .limit(5);
  if (logError) throw logError;

  const { data: progress, error: progressError } = await supabase
    .schema('registry')
    .from('sync_progress')
    .select('next_offset')
    .eq('list_id', 'contacts')
    .maybeSingle();
  if (progressError) throw progressError;

  const success = (latestRows ?? []).find(
    (r) => r.status === 'success' && r.started_at >= RESET_CUTOFF,
  );
  if (success) {
    console.log(`DONE: registry.sync_log id=${success.id} completed_at=${success.completed_at} — a genuine status='success' run since the cursor reset. Backlog fully drained.`);
    return true;
  }

  const latest = (latestRows ?? [])[0];
  if (latest && latest.errors && latest.errors > 0) {
    console.log(`ERRORS: registry.sync_log id=${latest.id} started_at=${latest.started_at} reported ${latest.errors} error(s) (records_in=${latest.records_in}, records_upserted=${latest.records_upserted}).`);
  }

  return { offset: (progress as { next_offset: number } | null)?.next_offset ?? null };
}

async function main() {
  let lastOffset: number | null = null;
  let staleCount = 0;
  let warnedStale = false;

  for (;;) {
    const result = await poll();
    if (result === true) break;

    const { offset } = result as { offset: number | null };
    if (offset === lastOffset) {
      staleCount++;
      if (staleCount >= 3 && !warnedStale) {
        console.log(`STALLED: registry.sync_progress offset stuck at ${offset} across ${staleCount} consecutive polls (~${(staleCount * POLL_MS) / 60000} min) — longer than the 5-minute cron cadence. Cron may have stopped firing.`);
        warnedStale = true;
      }
    } else {
      staleCount = 0;
      warnedStale = false;
      lastOffset = offset;
    }

    await sleep(POLL_MS);
  }
}

main().catch((err) => {
  console.error('MONITOR ERROR:', err);
  process.exit(1);
});
