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
  const { data: errs } = await supabase.from('results_changes_log').select('campaign_id').eq('status', 'ERROR');
  const cids = [...new Set((errs || []).map((r) => r.campaign_id).filter(Boolean))];
  console.log('Audit-log entries from Peter_AD against the affected campaigns:');
  for (const cid of cids) {
    const { data } = await supabase
      .from('results_changes_log')
      .select('status, attempted_upserts, created_at')
      .eq('campaign_id', cid)
      .eq('user_name', 'Peter_AD')
      .order('created_at', { ascending: false });
    if (data && data.length) {
      console.log(`\n  ${cid.slice(0,8)}…  (${data.length} entries by Peter_AD)`);
      data.forEach((d) => {
        const ups = (d.attempted_upserts || []).map((u) => `${u.first_name}/${u.category_code}`).join(', ');
        console.log(`    ${d.created_at}  ${d.status}  [${ups}]`);
      });
    }
  }
})();
