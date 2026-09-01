/*
 * Read-only: for campaigns dated in a given range (default: last calendar
 * week, Mon-Sun), show what pp_cnt/fp_cnt/fpsp_cnt/ir_cnt/team_size
 * currently hold on the campaign vs. what they'd be if derived from the
 * `results` table — i.e. a dry run for the Record Results count-backfill.
 *
 * Run: node scripts/investigate_last_week_counts.js [startDate] [endDate]
 *   dates as YYYY-MM-DD. Defaults to the Mon-Sun week before today.
 */

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

try { require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') }); }
catch {
  const envPath = path.join(__dirname, '..', '.env.local');
  if (fs.existsSync(envPath)) {
    fs.readFileSync(envPath, 'utf-8').split('\n').forEach((line) => {
      const t = line.trim();
      if (!t || t.startsWith('#')) return;
      const [k, ...rest] = t.split('=');
      if (k && rest.length) process.env[k.trim()] = rest.join('=').trim().replace(/^["']|["']$/g, '');
    });
  }
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

function defaultLastWeekRange() {
  const now = new Date();
  const day = now.getDay(); // 0=Sun..6=Sat
  const daysSinceMonday = (day + 6) % 7;
  const thisMonday = new Date(now);
  thisMonday.setDate(now.getDate() - daysSinceMonday);
  const lastMonday = new Date(thisMonday);
  lastMonday.setDate(thisMonday.getDate() - 7);
  const lastSunday = new Date(thisMonday);
  lastSunday.setDate(thisMonday.getDate() - 1);
  const fmt = (d) => d.toISOString().slice(0, 10);
  return { start: fmt(lastMonday), end: fmt(lastSunday) };
}

async function main() {
  const [argStart, argEnd] = process.argv.slice(2);
  const { start, end } = argStart && argEnd ? { start: argStart, end: argEnd } : defaultLastWeekRange();
  console.log(`Range: ${start} to ${end}\n`);

  const { data: campaigns, error: cErr } = await supabase
    .from('campaigns')
    .select('id, date, state, place, site, leader, team_size, pp_cnt, fp_cnt, fpsp_cnt, ir_cnt')
    .gte('date', start)
    .lte('date', end)
    .order('date', { ascending: true });
  if (cErr) throw cErr;

  console.log(`${campaigns.length} campaign(s) in range.\n`);
  if (campaigns.length === 0) return;

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

  let campaignsWithNames = 0;
  let campaignsWithMismatch = 0;

  for (const c of campaigns) {
    const derived = countsByCampaign.get(c.id) || { TM: 0, P: 0, F: 0, SP: 0, IR: 0 };
    const totalNames = derived.TM + derived.P + derived.F + derived.SP + derived.IR;
    if (totalNames === 0) continue; // nothing entered — skip from the report
    campaignsWithNames++;

    const current = {
      team_size: c.team_size, pp_cnt: c.pp_cnt, fp_cnt: c.fp_cnt, fpsp_cnt: c.fpsp_cnt, ir_cnt: c.ir_cnt,
    };
    const proposed = {
      team_size: derived.TM, pp_cnt: derived.P, fp_cnt: derived.F, fpsp_cnt: derived.SP, ir_cnt: derived.IR,
    };
    const mismatch = Object.keys(current).some((k) => (current[k] ?? null) !== proposed[k]);
    if (mismatch) campaignsWithMismatch++;

    console.log(`${c.date}  ${c.state}/${c.place}${c.site ? ' ' + c.site : ''}  (${c.leader})  [${c.id}]`);
    console.log(`  current : team_size=${current.team_size} pp=${current.pp_cnt} fp=${current.fp_cnt} fpsp=${current.fpsp_cnt} ir=${current.ir_cnt}`);
    console.log(`  derived : team_size=${proposed.team_size} pp=${proposed.pp_cnt} fp=${proposed.fp_cnt} fpsp=${proposed.fpsp_cnt} ir=${proposed.ir_cnt}${mismatch ? '  <-- would change' : ''}`);
  }

  console.log(`\n${campaignsWithNames} campaign(s) have at least one recorded name; ${campaignsWithMismatch} would change if backfilled.`);
}

main().catch((err) => { console.error(err); process.exit(1); });
