/**
 * One-off backfill: populate campaigns.team_size/pp_cnt/fp_cnt/fpsp_cnt/ir_cnt
 * for 2026-08-24 through 2026-09-01 (the week the bug was found, through the
 * day it was fixed), derived from the `results` table
 * (count of rows per category_code: TM->team_size, P->pp_cnt, F->fp_cnt,
 * SP->fpsp_cnt, IR->ir_cnt).
 *
 * Those columns stopped being kept in sync once the Record Results screen's
 * manual numeric inputs were replaced by per-category name grids (e93bd3c,
 * 88407aa) without the resulting counts ever being wired back into the
 * autosave path — see the fix in PR #172. This backfills the one week's
 * worth of names that were already typed in under the broken code, going
 * forward the app keeps these columns in sync itself.
 *
 * Only touches campaigns that have at least one `results` row in the range —
 * a campaign nobody has entered any names for is left untouched (null stays
 * null, rather than being turned into an authoritative-looking 0).
 *
 * Usage:
 *   node scripts/backfill_record_results_counts.js                    # dry-run summary
 *   node scripts/backfill_record_results_counts.js --apply            # actually write
 *   node scripts/backfill_record_results_counts.js START END [--apply] # custom date range
 *
 * Requirements: .env.local with NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
 *
 * Safety: idempotent — re-running recomputes from `results` and only writes
 * campaigns whose derived counts differ from what's currently stored.
 */
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const envPath = path.join(__dirname, '..', '.env.local');
fs.readFileSync(envPath, 'utf-8').split('\n').forEach((line) => {
  const t = line.trim();
  if (!t || t.startsWith('#')) return;
  const [k, ...rest] = t.split('=');
  if (k && rest.length) process.env[k.trim()] = rest.join('=').trim().replace(/^["']|["']$/g, '');
});

const args = process.argv.slice(2).filter((a) => a !== '--apply');
const apply = process.argv.includes('--apply');
const [start, end] = args.length >= 2 ? args : ['2026-08-24', '2026-09-01'];

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

async function main() {
  console.log(`${apply ? 'APPLYING' : 'DRY RUN'} — range ${start} to ${end}\n`);

  const { data: campaigns, error: cErr } = await supabase
    .from('campaigns')
    .select('id, date, state, place, site, leader, team_size, pp_cnt, fp_cnt, fpsp_cnt, ir_cnt')
    .gte('date', start)
    .lte('date', end);
  if (cErr) throw cErr;

  const { data: results, error: rErr } = await supabase
    .from('results')
    .select('campaign_id, category_code')
    .in('campaign_id', campaigns.map((c) => c.id));
  if (rErr) throw rErr;

  const countsByCampaign = new Map();
  for (const r of results) {
    const bucket = countsByCampaign.get(r.campaign_id) || { TM: 0, P: 0, F: 0, SP: 0, IR: 0 };
    if (bucket[r.category_code] !== undefined) bucket[r.category_code]++;
    countsByCampaign.set(r.campaign_id, bucket);
  }

  let changed = 0;
  let skippedNoNames = 0;
  let skippedAlreadyCorrect = 0;

  for (const c of campaigns) {
    const derived = countsByCampaign.get(c.id);
    if (!derived) { skippedNoNames++; continue; }
    const totalNames = derived.TM + derived.P + derived.F + derived.SP + derived.IR;
    if (totalNames === 0) { skippedNoNames++; continue; }

    const proposed = {
      team_size: derived.TM, pp_cnt: derived.P, fp_cnt: derived.F, fpsp_cnt: derived.SP, ir_cnt: derived.IR,
    };
    const current = {
      team_size: c.team_size, pp_cnt: c.pp_cnt, fp_cnt: c.fp_cnt, fpsp_cnt: c.fpsp_cnt, ir_cnt: c.ir_cnt,
    };
    const isDifferent = Object.keys(proposed).some((k) => (current[k] ?? null) !== proposed[k]);
    if (!isDifferent) { skippedAlreadyCorrect++; continue; }

    changed++;
    const label = `${c.date}  ${c.state}/${c.place}${c.site ? ' ' + c.site : ''}  (${c.leader})`;
    console.log(`${apply ? 'UPDATE' : 'WOULD UPDATE'}  ${label}`);
    console.log(`  before: team_size=${current.team_size} pp=${current.pp_cnt} fp=${current.fp_cnt} fpsp=${current.fpsp_cnt} ir=${current.ir_cnt}`);
    console.log(`  after : team_size=${proposed.team_size} pp=${proposed.pp_cnt} fp=${proposed.fp_cnt} fpsp=${proposed.fpsp_cnt} ir=${proposed.ir_cnt}`);

    if (apply) {
      const { error: uErr } = await supabase.from('campaigns').update(proposed).eq('id', c.id);
      if (uErr) {
        console.error(`  FAILED: ${uErr.message}`);
      }
    }
  }

  console.log(`\n${campaigns.length} campaign(s) in range: ${changed} ${apply ? 'updated' : 'would update'}, ${skippedAlreadyCorrect} already correct, ${skippedNoNames} have no names recorded (left untouched).`);
  if (!apply && changed > 0) console.log('\nRe-run with --apply to write these changes.');
}

main().catch((err) => { console.error(err); process.exit(1); });
