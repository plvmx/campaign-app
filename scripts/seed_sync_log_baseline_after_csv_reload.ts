/**
 * Seeds a single synthetic "completed" row into registry.sync_log so that
 * the next ac-sync invocation uses filters[updated_after] instead of
 * treating itself as a first-ever full backfill.
 *
 * Why this is needed: getLastCompletedSyncTimestamp() (supabase/functions/ac-sync/db.ts)
 * is `select max(completed_at) from registry.sync_log where run_type='sync'
 * and status='success'`. Confirmed live 2026-09-09, after the registrations
 * CSV reload: this has *never* returned a row — every sync_log entry before
 * the reload was 'partial' (time-budget-limited), none ever completed. So
 * without this, invoking ac-sync now would re-crawl the entire AC account
 * (~14,000+ contacts) from scratch instead of a targeted catch-up — not
 * unsafe any more (registrants are now matched by email, not
 * ac_contact_id, so re-discovering an already-loaded person updates them
 * in place rather than duplicating), just extremely slow for what's
 * actually needed: picking up whatever changed in AC since the CSV
 * reload's effective cutoff.
 *
 * See docs/registry-pipeline/OPERATIONS.md's registrations-reload entries
 * for the full context.
 *
 * Usage:
 *   npx tsx scripts/seed_sync_log_baseline_after_csv_reload.ts <ISO-cutoff>          # dry run
 *   npx tsx scripts/seed_sync_log_baseline_after_csv_reload.ts <ISO-cutoff> --apply  # actually insert
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

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const cutoff = args.find((a) => !a.startsWith('--'));

if (!cutoff || Number.isNaN(new Date(cutoff).getTime())) {
  console.error('Usage: npx tsx scripts/seed_sync_log_baseline_after_csv_reload.ts <ISO-cutoff> [--apply]');
  console.error('Example cutoff: 2026-08-22T00:00:00Z');
  process.exit(1);
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

async function main() {
  const { data: existing, error: existingError } = await supabase
    .schema('registry')
    .from('sync_log')
    .select('id, completed_at')
    .eq('run_type', 'sync')
    .eq('status', 'success')
    .order('completed_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existingError) throw existingError;

  if (existing) {
    console.error(`registry.sync_log already has a completed sync (id=${existing.id}, completed_at=${existing.completed_at}) — refusing to seed another baseline on top of a real one. If you genuinely want to move the cursor, do it deliberately in the SQL Editor instead of via this script.`);
    process.exit(1);
  }

  const row = {
    run_type: 'sync' as const,
    status: 'success' as const,
    started_at: cutoff,
    completed_at: cutoff,
    records_in: 0,
    records_upserted: 0,
    errors: 0,
    notes: `SYNTHETIC — not a real ac-sync invocation. Manually seeded to mark the registrations CSV reload's effective cutoff as the incremental-sync baseline, so the next real ac-sync run uses filters[updated_after]=${cutoff} instead of treating itself as a first-ever backfill. See docs/registry-pipeline/OPERATIONS.md.`,
  };

  if (!apply) {
    console.log('Dry run — would insert:');
    console.log(JSON.stringify(row, null, 2));
    console.log('\nPass --apply to actually insert.');
    return;
  }

  const { error } = await supabase.schema('registry').from('sync_log').insert(row);
  if (error) throw error;
  console.log(`Inserted synthetic sync_log baseline at ${cutoff}.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
