/* Recover names that were silently lost when the results.category_code CHECK
 * constraint rejected entire save batches containing a 'TM' (Team Member) row.
 *
 * For each (campaign_id, user_id) pair that has any ERROR audit-log entries,
 * find the LAST one — it carries the most complete set the user attempted —
 * and insert those names as fresh results rows attributed to that user.
 *
 * Dry-run by default. Pass --apply to actually write.
 *
 *   node scripts/recover_lost_results.js          # preview
 *   node scripts/recover_lost_results.js --apply  # commit
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

const APPLY = process.argv.includes('--apply');
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

(async () => {
  // Pull every ERROR entry. The audit table is small.
  const { data: errors, error } = await supabase
    .from('results_changes_log')
    .select('campaign_id, user_id, user_name, attempted_upserts, created_at')
    .eq('status', 'ERROR')
    .order('created_at', { ascending: true });
  if (error) { console.error(error); process.exit(1); }
  console.log(`Loaded ${errors.length} ERROR audit entries.`);

  // Group: for each (campaign_id, user_id), keep the latest entry.
  const latestByKey = new Map();
  for (const r of errors) {
    if (!r.campaign_id || !r.user_id) continue;
    const k = `${r.campaign_id}::${r.user_id}`;
    const prev = latestByKey.get(k);
    if (!prev || r.created_at > prev.created_at) latestByKey.set(k, r);
  }
  console.log(`Distinct (campaign, user) pairs with ERROR history: ${latestByKey.size}`);

  let totalRows = 0;
  let totalSkipped = 0;
  let totalInserted = 0;
  const summary = [];

  for (const [, r] of latestByKey) {
    const ups = r.attempted_upserts || [];
    if (ups.length === 0) continue;

    // What's already on the server for this campaign? (We don't want to
    // re-insert names that were saved later via some other path.)
    const { data: existing } = await supabase
      .from('results')
      .select('first_name, category_code')
      .eq('campaign_id', r.campaign_id);
    const haveSet = new Set((existing || []).map((x) => `${x.first_name}:${x.category_code}`));

    const toInsert = ups.filter((u) => !haveSet.has(`${u.first_name}:${u.category_code}`));
    const skipped  = ups.length - toInsert.length;

    summary.push({
      user: r.user_name,
      campaign: r.campaign_id.slice(0, 8) + '…',
      attempted: ups.length,
      already_saved: skipped,
      to_insert: toInsert.length,
      names_to_insert: toInsert.map((u) => `${u.first_name}/${u.category_code}`).join(', '),
    });

    totalRows    += ups.length;
    totalSkipped += skipped;
    totalInserted += toInsert.length;

    if (APPLY && toInsert.length > 0) {
      const rows = toInsert.map((u) => ({
        campaign_id:   r.campaign_id,
        first_name:    u.first_name,
        category_code: u.category_code,
        user_id:       r.user_id,
      }));
      const { error: insErr } = await supabase.from('results').insert(rows);
      if (insErr) {
        console.error(`  FAILED inserting for ${r.user_name} / ${r.campaign_id}:`, insErr.message);
      }
    }
  }

  console.log('\nPer-(user, campaign) plan:');
  summary.forEach((s) => {
    console.log(`  ${s.user.padEnd(15)} ${s.campaign}  attempted=${String(s.attempted).padStart(3)} already=${String(s.already_saved).padStart(3)} to_insert=${String(s.to_insert).padStart(3)}`);
    if (s.to_insert > 0) console.log(`      ${s.names_to_insert}`);
  });

  console.log('\nTotals:');
  console.log(`  attempted across all batches: ${totalRows}`);
  console.log(`  already on server (skip):     ${totalSkipped}`);
  console.log(`  to insert:                    ${totalInserted}`);

  if (!APPLY) {
    console.log('\nDRY RUN — re-run with --apply to actually insert.');
  } else {
    console.log('\nApplied.');
  }
})();
