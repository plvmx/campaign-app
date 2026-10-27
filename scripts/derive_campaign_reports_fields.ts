/**
 * Campaign Report project — see docs/campaign-report/BRIEF.md.
 *
 * Populates campaign_reports.derived_state/derived_place/derived_leader for
 * every row (the original 2026-05-06 cutoff was lifted 2026-10-24),
 * by matching location_raw/leader_raw against state_places/state_leaders —
 * see lib/campaignReportMatcher.ts for the matching rules and rationale.
 *
 * Requires scripts/add_derived_fields_to_campaign_reports.sql to already
 * have been run in the Supabase SQL Editor.
 *
 * Idempotent — safe to re-run any time (e.g. after tuning the matcher; the
 * /api/cron/campaign-report-sync job already runs the same step after each sheet sync): recomputes from
 * scratch and only writes rows whose derived values actually changed.
 *
 * Usage:
 *   npx tsx scripts/derive_campaign_reports_fields.ts          # dry-run summary
 *   npx tsx scripts/derive_campaign_reports_fields.ts --apply  # actually write
 *   add --overwrite to recompute fields that already have a value (after changing the matcher);
 *   by default only empty fields are filled, so hand-entered values and location aliases survive
 */
import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import { deriveCampaignReportFieldsSince, DERIVE_SINCE } from '../lib/services/campaignReportSyncService';

const envPath = path.join(__dirname, '..', '.env.local');
fs.readFileSync(envPath, 'utf-8').split('\n').forEach((line) => {
  const t = line.trim();
  if (!t || t.startsWith('#')) return;
  const [k, ...rest] = t.split('=');
  if (k && rest.length) process.env[k.trim()] = rest.join('=').trim().replace(/^["']|["']$/g, '');
});

const apply = process.argv.includes('--apply');
const overwrite = process.argv.includes('--overwrite');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

console.log(`${apply ? 'APPLYING' : 'DRY RUN'} — deriving state/place/leader for campaign_reports rows submitted since ${DERIVE_SINCE}\n`);
deriveCampaignReportFieldsSince(supabase, DERIVE_SINCE, apply, overwrite)
  .then((r) => {
    console.log(`${r.inScope} row(s) in scope; ${r.unresolved} with no state resolved.`);
    console.log(`${r.noPlaceRows} row(s) (${r.noPlaceLocations} locations) still have no place.`);
    console.log(`${r.updated} ${apply ? 'updated' : 'would update'}${overwrite ? ' (overwriting existing values)' : ' (empty fields only)'}.`);
    if (!apply && r.updated > 0) console.log('\nRe-run with --apply to write these changes.');
  })
  .catch((err) => { console.error(err); process.exit(1); });
