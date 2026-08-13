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
  // Find every distinct campaign with ERROR audit history
  const { data: errs } = await supabase
    .from('results_changes_log')
    .select('campaign_id')
    .eq('status', 'ERROR');
  const cids = [...new Set((errs || []).map((r) => r.campaign_id).filter(Boolean))];
  console.log('Affected campaigns:', cids.length);

  for (const cid of cids) {
    const { data: c } = await supabase.from('campaigns').select('id, place, date, leader, user_id').eq('id', cid).single();
    if (!c) { console.log(`${cid}: campaign not found`); continue; }
    const { data: rows } = await supabase
      .from('results')
      .select('first_name, category_code, user_id, created_at')
      .eq('campaign_id', cid)
      .order('created_at', { ascending: true });
    console.log(`\n${c.place} ${c.date} leader=${c.leader}  id=${cid.slice(0,8)}…`);
    console.log(`  ${rows.length} rows currently in results:`);
    rows.forEach((r) => console.log(`    [${r.category_code}] ${r.first_name}  user=${r.user_id.slice(0,8)}…  at=${r.created_at}`));
  }
})();
