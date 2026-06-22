const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const envPath = path.join('/Users/peterviertmann/Development/campaign-app', '.env.local');
fs.readFileSync(envPath, 'utf-8').split('\n').forEach((line) => {
  const t = line.trim();
  if (!t || t.startsWith('#')) return;
  const [k, ...rest] = t.split('=');
  if (k && rest.length) process.env[k.trim()] = rest.join('=').trim().replace(/^["']|["']$/g, '');
});
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
(async () => {
  const { data } = await supabase
    .from('results_changes_log')
    .select('user_name, campaign_id, status')
    .order('created_at', { ascending: false })
    .limit(2000);
  const byUser = {};
  (data || []).forEach((r) => {
    const k = `${r.user_name || '?'}::${r.campaign_id?.slice(0,8) || '?'}`;
    if (!byUser[k]) byUser[k] = { s: 0, e: 0 };
    if (r.status === 'SUCCESS') byUser[k].s++; else byUser[k].e++;
  });
  console.log('user::campaign  success  error');
  Object.entries(byUser).sort((a,b) => b[1].e - a[1].e).slice(0, 30).forEach(([k, v]) => {
    console.log(`  ${k}  ${v.s}  ${v.e}`);
  });
})();
