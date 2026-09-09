/**
 * Resets registry.sync_progress's 'contacts' row so the next ac-sync
 * invocation restarts the /contacts id-cursor sweep from offset 0.
 *
 * Why: confirmed live 2026-09-09 that this cursor was never reset when
 * today's filters[updated_after]=2026-08-22 catch-up began — it was still
 * carrying whatever position the abandoned, unfiltered full-account crawl
 * (paused mid-stream by the 2026-09-02 strategic pivot, see
 * docs/registry-pipeline/OPERATIONS.md) had reached. Applying that
 * leftover position as the starting offset for today's much smaller,
 * differently-filtered result set (3,496 total, per a live AC API check)
 * means whatever range that leftover position skipped past is silently
 * never visited (offset only ever moves forward). Resetting to 0 is safe:
 * upsertRegistrant() is idempotent on email, so re-visiting contacts
 * already caught today just re-confirms them.
 *
 * Usage:
 *   npx tsx scripts/reset_sync_progress_contacts_cursor.ts          # dry run
 *   npx tsx scripts/reset_sync_progress_contacts_cursor.ts --apply  # actually reset
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

const apply = process.argv.includes('--apply');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

async function main() {
  const { data: existing, error: readError } = await supabase
    .schema('registry')
    .from('sync_progress')
    .select('*')
    .eq('list_id', 'contacts')
    .maybeSingle();
  if (readError) throw readError;

  if (!existing) {
    console.log("No 'contacts' row in registry.sync_progress — nothing to reset, next invocation already starts at offset 0.");
    return;
  }

  console.log('Current row:', JSON.stringify(existing, null, 2));

  if (!apply) {
    console.log('\nDry run — would delete this row (same effect as the code\'s own clearSyncProgress: getSyncProgress returns null next time, offset defaults to 0). Pass --apply to actually do it.');
    return;
  }

  const { error: deleteError } = await supabase
    .schema('registry')
    .from('sync_progress')
    .delete()
    .eq('list_id', 'contacts');
  if (deleteError) throw deleteError;
  console.log("Deleted registry.sync_progress's 'contacts' row — next ac-sync invocation will start the /contacts sweep from offset 0.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
