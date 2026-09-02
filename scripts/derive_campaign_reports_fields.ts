/**
 * Campaign Report project — see docs/campaign-report/BRIEF.md.
 *
 * Populates campaign_reports.derived_state/derived_place/derived_leader for
 * rows submitted on/after 2026-05-06 (the project's resumed, narrowed scope),
 * by matching location_raw/leader_raw against state_places/state_leaders —
 * see lib/campaignReportMatcher.ts for the matching rules and rationale.
 *
 * Requires scripts/add_derived_fields_to_campaign_reports.sql to already
 * have been run in the Supabase SQL Editor.
 *
 * Idempotent — safe to re-run any time (e.g. after tuning the matcher, or to
 * pick up newly-imported rows from a future catch-up dump): recomputes from
 * scratch and only writes rows whose derived values actually changed.
 *
 * Usage:
 *   npx tsx scripts/derive_campaign_reports_fields.ts          # dry-run summary
 *   npx tsx scripts/derive_campaign_reports_fields.ts --apply  # actually write
 */
import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import { deriveCampaignReportFields, type PlaceRef, type LeaderRef } from '../lib/campaignReportMatcher';

const envPath = path.join(__dirname, '..', '.env.local');
fs.readFileSync(envPath, 'utf-8').split('\n').forEach((line) => {
  const t = line.trim();
  if (!t || t.startsWith('#')) return;
  const [k, ...rest] = t.split('=');
  if (k && rest.length) process.env[k.trim()] = rest.join('=').trim().replace(/^["']|["']$/g, '');
});

const apply = process.argv.includes('--apply');
const SINCE = '2026-05-06';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

interface ReportRow {
  id: string;
  location_raw: string | null;
  leader_raw: string | null;
  derived_state: string | null;
  derived_place: string | null;
  derived_leader: string | null;
}

async function main() {
  console.log(`${apply ? 'APPLYING' : 'DRY RUN'} — deriving state/place/leader for campaign_reports rows submitted since ${SINCE}\n`);

  const { data: reports, error: rErr } = await supabase
    .from('campaign_reports')
    .select('id, location_raw, leader_raw, derived_state, derived_place, derived_leader')
    .gte('submitted_at', SINCE);
  if (rErr) throw rErr;

  const { data: places, error: pErr } = await supabase.from('state_places').select('state, place');
  if (pErr) throw pErr;
  const { data: leaders, error: lErr } = await supabase.from('state_leaders').select('state, leader');
  if (lErr) throw lErr;

  let changed = 0;
  let unchanged = 0;
  let unresolved = 0;
  let stateOnly = 0;
  let full = 0;

  for (const row of reports as ReportRow[]) {
    const derived = deriveCampaignReportFields(row, places as PlaceRef[], leaders as LeaderRef[]);

    const isDifferent =
      (row.derived_state ?? null) !== derived.state ||
      (row.derived_place ?? null) !== derived.place ||
      (row.derived_leader ?? null) !== derived.leader;

    if (!derived.state) unresolved++;
    else if (derived.place && derived.leader) full++;
    else stateOnly++;

    if (!isDifferent) { unchanged++; continue; }
    changed++;

    if (apply) {
      const { error: uErr } = await supabase
        .from('campaign_reports')
        .update({ derived_state: derived.state, derived_place: derived.place, derived_leader: derived.leader })
        .eq('id', row.id);
      if (uErr) console.error(`  FAILED (${row.id}): ${uErr.message}`);
    }
  }

  console.log(`${reports!.length} row(s) in scope.`);
  console.log(`  state resolved:        ${reports!.length - unresolved} (${(100 * (reports!.length - unresolved) / reports!.length).toFixed(1)}%)`);
  console.log(`  fully resolved (all 3): ${full} (${(100 * full / reports!.length).toFixed(1)}%)`);
  console.log(`  state only (partial):  ${stateOnly}`);
  console.log(`  unresolved:            ${unresolved}`);
  console.log(`\n${changed} ${apply ? 'updated' : 'would update'}, ${unchanged} already correct.`);
  if (!apply && changed > 0) console.log('\nRe-run with --apply to write these changes.');
}

main().catch((err) => { console.error(err); process.exit(1); });
