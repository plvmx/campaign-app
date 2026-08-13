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
  console.log('=== Campaign record(s) for Lidcombe NSW 2026-07-16 13:00 ===');
  const { data: campaigns, error: cErr } = await supabase
    .from('campaigns')
    .select('*')
    .eq('state', 'NSW')
    .ilike('place', 'Lidcombe')
    .eq('date', '2026-07-16');
  if (cErr) console.error('campaigns error', cErr);
  console.log(JSON.stringify(campaigns, null, 2));

  console.log('\n=== Matching campaign_rules for NSW / Lidcombe / Thursday ===');
  const { data: rules, error: rErr } = await supabase
    .from('campaign_rules')
    .select('*')
    .eq('state', 'NSW')
    .ilike('place', 'Lidcombe');
  if (rErr) console.error('rules error', rErr);
  console.log(JSON.stringify(rules, null, 2));

  if (campaigns && campaigns.length) {
    for (const c of campaigns) {
      console.log(`\n=== campaign_changes_log for campaign ${c.id} ===`);
      const { data: logs, error: lErr } = await supabase
        .from('campaign_changes_log')
        .select('*')
        .eq('campaign_id', c.id)
        .order('created_at', { ascending: true });
      if (lErr) console.error('log error', lErr);
      console.log(JSON.stringify(logs, null, 2));
    }
  }

  console.log('\n=== Recent weekly_refresh_log entries ===');
  const { data: refreshLogs, error: wErr } = await supabase
    .from('weekly_refresh_log')
    .select('*')
    .order('completed_at', { ascending: false })
    .limit(10);
  if (wErr) console.error('weekly_refresh_log error', wErr);
  console.log(JSON.stringify(refreshLogs, null, 2));
})();
