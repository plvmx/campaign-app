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
const PETER = '0de049a4-eeba-4e15-9188-54d0c7896201';
(async () => {
  // Rows authored by Peter_AD ANYWHERE
  const { data: peterRows, count } = await supabase
    .from('results')
    .select('campaign_id, first_name, category_code, created_at', { count: 'exact' })
    .eq('user_id', PETER)
    .order('created_at', { ascending: false })
    .limit(20);
  console.log(`Rows authored by Peter_AD: ${count}`);
  (peterRows || []).forEach((r) => console.log(`  ${r.created_at}  campaign=${r.campaign_id.slice(0,8)}…  [${r.category_code}] ${r.first_name}`));

  // For the affected campaigns, list users that have saved into them
  const cids = ['1638aeed-...', '63413733-...', 'ecabbccd-...', '00726482-...', '7d70bc84-...', 'a8a90466-...', '0ed573b9-...'];
  const { data: aErrs } = await supabase.from('results_changes_log').select('campaign_id').eq('status', 'ERROR');
  const distinctCids = [...new Set((aErrs || []).map((r) => r.campaign_id).filter(Boolean))];
  console.log('\nFor each affected campaign — distinct user_ids that have rows currently:');
  for (const cid of distinctCids) {
    const { data: rows } = await supabase.from('results').select('user_id').eq('campaign_id', cid);
    const users = [...new Set((rows || []).map((r) => r.user_id))];
    console.log(`  ${cid.slice(0,8)}…  users=${users.map((u) => u.slice(0,8)).join(',') || '(none)'}  rows=${rows.length}`);
  }
})();
