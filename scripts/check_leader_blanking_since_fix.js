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
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

(async () => {
  console.log('=== Any campaigns currently with a blank/null leader ===');
  const { data: blankNow, error: bErr } = await supabase
    .from('campaigns')
    .select('id, date, state, place, time, leader, source, created_at')
    .or('leader.is.null,leader.eq.');
  if (bErr) console.error(bErr);
  console.log(JSON.stringify(blankNow, null, 2));

  console.log('\n=== campaign_changes_log rows where new_data.leader is empty, since 2026-07-08 (fix merge date) ===');
  const { data: logs, error: lErr } = await supabase
    .from('campaign_changes_log')
    .select('*')
    .gte('created_at', '2026-07-08T00:00:00Z')
    .order('created_at', { ascending: true });
  if (lErr) console.error(lErr);
  const blanked = (logs || []).filter(r => r.new_data && (r.new_data.leader === '' || r.new_data.leader === null));
  console.log(`Total log rows since fix: ${logs?.length}. Blank-leader rows: ${blanked.length}`);
  console.log(JSON.stringify(blanked, null, 2));
})();
