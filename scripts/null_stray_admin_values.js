// One-off: null out state_leaders.admin where the value is neither 'AD' nor 'SR'.
//
// Background: the admin column is meant to hold 'AD' (full admin), 'SR' (state
// reporter) or null. Some rows had a recruiter's name in there ("Lorraine",
// "Arun", "Charles"), which had been miscategorising those leaders on sign-in.
// The login page bug was fixed in PR #78; this script cleans up the data so
// the column means exactly one thing.
//
// Run:   node scripts/null_stray_admin_values.js [--dry-run]
// Safe to re-run; idempotent.

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

const dryRun = process.argv.includes('--dry-run');
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

(async () => {
  // Fetch all rows with a non-null admin value, then filter in JS — PostgREST's
  // .not('admin', 'in', '(AD,SR)') quoting is fiddly and this dataset is small.
  const { data: rows, error: fetchErr } = await supabase
    .from('state_leaders')
    .select('id, state, leader, mobile, admin')
    .not('admin', 'is', null);
  if (fetchErr) {
    console.error('Failed to fetch state_leaders:', fetchErr);
    process.exit(1);
  }

  const stray = rows.filter((r) => r.admin !== 'AD' && r.admin !== 'SR');
  console.log(`Found ${stray.length} row(s) with stray admin values:`);
  stray.forEach((r) => {
    console.log(`  ${r.state.padEnd(4)} ${r.leader.padEnd(20)} ${(r.mobile ?? '').padEnd(14)} admin=${JSON.stringify(r.admin)}`);
  });

  if (stray.length === 0) {
    console.log('Nothing to do.');
    return;
  }

  if (dryRun) {
    console.log('\n[dry-run] Skipping update. Re-run without --dry-run to apply.');
    return;
  }

  const ids = stray.map((r) => r.id);
  const { error: updateErr, count } = await supabase
    .from('state_leaders')
    .update({ admin: null }, { count: 'exact' })
    .in('id', ids);
  if (updateErr) {
    console.error('Update failed:', updateErr);
    process.exit(1);
  }
  console.log(`\nUpdated ${count ?? ids.length} row(s): admin set to null.`);
})();
