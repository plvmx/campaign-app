/*
 * Read-only diagnostic for the "names disappear from Record Results" bug.
 * Tests:
 *   1. Distribution of `*_cnt` field vs actual row count per category.
 *   2. Campaigns with non-zero counts but zero name rows (or rows < count).
 *   3. Duplicate-first-name collision signal: per state, how often does the
 *      same first_name appear more than once in the same (campaign, category)?
 *      If the schema is collision-free this should occasionally be > 1 (real
 *      world has repeat names); if it's NEVER > 1 across thousands of rows,
 *      that's evidence the upsert key is silently deduplicating.
 *   4. Per-leader skew: which leaders see the worst count-vs-rows gap.
 *
 * Run: node scripts/diagnose_results_loss.js
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

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error('Missing Supabase env vars'); process.exit(1); }
const supabase = createClient(url, key);

// Mapping: campaigns.<col>  <->  results.category_code
const CATEGORY_MAP = [
  { col: 'pp_cnt',   code: 'P',  label: 'Partial Presentations' },
  { col: 'fp_cnt',   code: 'F',  label: 'Full Presentations Only' },
  { col: 'fpsp_cnt', code: 'SP', label: 'Full Presentations + Sinners Prayer' },
  { col: 'ir_cnt',   code: 'IR', label: 'Information Requests' },
];

async function fetchAll(table, select, extra) {
  const pageSize = 1000;
  let from = 0;
  const out = [];
  while (true) {
    let q = supabase.from(table).select(select).range(from, from + pageSize - 1);
    if (extra) q = extra(q);
    const { data, error } = await q;
    if (error) throw error;
    if (!data || data.length === 0) break;
    out.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return out;
}

(async () => {
  console.log('Fetching campaigns…');
  const campaigns = await fetchAll(
    'campaigns',
    'id, date, state, place, leader, actual_leader, pp_cnt, fp_cnt, fpsp_cnt, ir_cnt, team_size, created_at',
  );
  console.log(`  ${campaigns.length} campaigns`);

  console.log('Fetching results…');
  const results = await fetchAll('results', 'campaign_id, first_name, category_code, created_at');
  console.log(`  ${results.length} result rows`);

  // Index results by (campaign_id, category_code) -> first_names[]
  const byCC = new Map();
  for (const r of results) {
    const k = `${r.campaign_id}::${r.category_code}`;
    if (!byCC.has(k)) byCC.set(k, []);
    byCC.get(k).push(r.first_name);
  }
  const rowCount = (cid, code) => (byCC.get(`${cid}::${code}`) || []).length;

  // ----- Test 1: count vs row count distribution per category -----
  console.log('\n========== TEST 1: Count field vs actual rows (per category) ==========');
  for (const { col, code, label } of CATEGORY_MAP) {
    let eq = 0, countGreater = 0, rowsGreater = 0, bothZero = 0, countOnly = 0, rowsOnly = 0;
    let totalCountSum = 0, totalRowsSum = 0;
    let worstGap = { cid: null, count: 0, rows: 0, gap: 0 };
    for (const c of campaigns) {
      const cnt = c[col] || 0;
      const rows = rowCount(c.id, code);
      totalCountSum += cnt;
      totalRowsSum += rows;
      if (cnt === 0 && rows === 0) bothZero++;
      else if (cnt === rows) eq++;
      else if (cnt > 0 && rows === 0) countOnly++;
      else if (cnt === 0 && rows > 0) rowsOnly++;
      else if (cnt > rows) countGreater++;
      else rowsGreater++;
      const gap = cnt - rows;
      if (gap > worstGap.gap) worstGap = { cid: c.id, count: cnt, rows, gap };
    }
    console.log(`\n  [${code}] ${label}  (${col})`);
    console.log(`    matches (cnt == rows, both > 0): ${eq}`);
    console.log(`    cnt > rows (potential loss):     ${countGreater}`);
    console.log(`    rows > cnt (cnt under-reported): ${rowsGreater}`);
    console.log(`    cnt > 0, rows = 0 (all lost?):   ${countOnly}`);
    console.log(`    cnt = 0, rows > 0 (cnt blank):   ${rowsOnly}`);
    console.log(`    both zero (no data):             ${bothZero}`);
    console.log(`    SUM(cnt)=${totalCountSum}  SUM(rows)=${totalRowsSum}  diff=${totalCountSum - totalRowsSum}`);
    if (worstGap.gap > 0) {
      console.log(`    worst single-campaign gap: cnt=${worstGap.count} rows=${worstGap.rows} (cid=${worstGap.cid})`);
    }
  }

  // ----- Test 2: campaigns with any count > 0 but zero result rows AT ALL -----
  console.log('\n========== TEST 2: Campaigns with non-zero counts but ZERO result rows total ==========');
  const totalRowsByCampaign = new Map();
  for (const r of results) {
    totalRowsByCampaign.set(r.campaign_id, (totalRowsByCampaign.get(r.campaign_id) || 0) + 1);
  }
  let zeroRowsButCounts = 0;
  let zeroRowsCountSum = 0;
  const recentExamples = [];
  for (const c of campaigns) {
    const totalCnt = (c.pp_cnt || 0) + (c.fp_cnt || 0) + (c.fpsp_cnt || 0) + (c.ir_cnt || 0);
    const totalRows = totalRowsByCampaign.get(c.id) || 0;
    if (totalCnt > 0 && totalRows === 0) {
      zeroRowsButCounts++;
      zeroRowsCountSum += totalCnt;
      if (recentExamples.length < 10) recentExamples.push({ id: c.id, date: c.date, state: c.state, place: c.place, leader: c.leader, totalCnt });
    }
  }
  console.log(`  ${zeroRowsButCounts} campaigns have totalCnt > 0 but ZERO name rows`);
  console.log(`  Sum of counts on those campaigns: ${zeroRowsCountSum} (notional names that should exist but don't)`);
  if (recentExamples.length) {
    console.log('  Examples (up to 10):');
    recentExamples.forEach((e) => console.log(`    ${e.date} ${e.state} ${e.place} (leader: ${e.leader}) totalCnt=${e.totalCnt}`));
  }

  // ----- Test 3: duplicate first-name collision signal -----
  console.log('\n========== TEST 3: Duplicate-first-name signal ==========');
  // Within each (campaign, category), are there any first_names that appear > once?
  // Schema today: PK is (campaign_id, first_name, category_code) so this CANNOT
  // exceed 1. Confirm and report total rows for context.
  let maxDupInGroup = 0;
  for (const [, names] of byCC) {
    const counts = new Map();
    for (const n of names) counts.set(n, (counts.get(n) || 0) + 1);
    for (const v of counts.values()) if (v > maxDupInGroup) maxDupInGroup = v;
  }
  console.log(`  Max duplicate first_name within a single (campaign, category): ${maxDupInGroup}`);
  console.log(`  (If schema is collision-prone, this will be 1 — which means two attendees with the same first name CANNOT both be stored.)`);

  // How often do common first names appear ANYWHERE — gives a sense of how
  // many real-world repeats we'd expect to lose to collisions.
  const nameFreq = new Map();
  for (const r of results) nameFreq.set(r.first_name, (nameFreq.get(r.first_name) || 0) + 1);
  const top = [...nameFreq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15);
  console.log('  Top 15 most-common first names across all results:');
  top.forEach(([n, c]) => console.log(`    ${n.padEnd(20)} ${c}`));

  // For each campaign+category group, how many DISTINCT names vs how many SLOTS
  // (3 fields per row * N rows in UI). We can approximate by comparing rows
  // count to the relevant *_cnt — already done in Test 1 — but here we look at
  // how often two attendees in DIFFERENT categories share a first_name in the
  // same campaign (real-world signal that common-name collisions WILL happen).
  const byCampaign = new Map();
  for (const r of results) {
    if (!byCampaign.has(r.campaign_id)) byCampaign.set(r.campaign_id, []);
    byCampaign.get(r.campaign_id).push(r);
  }
  let campaignsWithSharedNames = 0;
  for (const [, rs] of byCampaign) {
    const seen = new Map();
    for (const r of rs) {
      seen.set(r.first_name, (seen.get(r.first_name) || 0) + 1);
    }
    if ([...seen.values()].some((v) => v > 1)) campaignsWithSharedNames++;
  }
  console.log(`  Campaigns where the same first_name appears in more than one category: ${campaignsWithSharedNames}`);
  console.log(`  (Each of those is a campaign where collision-prone schema would have lost at least 1 name had they been in the SAME category.)`);

  // ----- Test 4: per-leader skew -----
  console.log('\n========== TEST 4: Leaders with the biggest cnt-vs-rows gap ==========');
  const leaderGap = new Map(); // leader -> { cntSum, rowsSum, campaigns }
  for (const c of campaigns) {
    const totalCnt = (c.pp_cnt || 0) + (c.fp_cnt || 0) + (c.fpsp_cnt || 0) + (c.ir_cnt || 0);
    const totalRows = totalRowsByCampaign.get(c.id) || 0;
    const leader = c.actual_leader || c.leader || '(none)';
    if (!leaderGap.has(leader)) leaderGap.set(leader, { cntSum: 0, rowsSum: 0, campaigns: 0 });
    const g = leaderGap.get(leader);
    g.cntSum += totalCnt;
    g.rowsSum += totalRows;
    g.campaigns++;
  }
  const ranked = [...leaderGap.entries()]
    .map(([l, g]) => ({ leader: l, ...g, gap: g.cntSum - g.rowsSum }))
    .filter((x) => x.cntSum >= 5) // only leaders with non-trivial activity
    .sort((a, b) => b.gap - a.gap)
    .slice(0, 15);
  console.log('  Top 15 leaders by total (cnt - rows) gap (cnt >= 5):');
  console.log('    leader                              campaigns    cntSum   rowsSum   gap');
  ranked.forEach((x) => {
    console.log(`    ${x.leader.padEnd(35)} ${String(x.campaigns).padStart(8)}  ${String(x.cntSum).padStart(8)}  ${String(x.rowsSum).padStart(8)}  ${String(x.gap).padStart(6)}`);
  });

  console.log('\nDone.');
})().catch((e) => { console.error(e); process.exit(1); });
