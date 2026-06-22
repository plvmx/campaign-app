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
  const { data } = await supabase
    .from('results_changes_log')
    .select('status, attempted_upserts')
    .eq('user_name', 'Peter_AD')
    .order('created_at', { ascending: false })
    .limit(70);
  const cats = {};
  let withTM = 0, anyBatches = (data || []).length;
  (data || []).forEach((l) => {
    (l.attempted_upserts || []).forEach((u) => { cats[u.category_code] = (cats[u.category_code] || 0) + 1; });
    if ((l.attempted_upserts || []).some((u) => u.category_code === 'TM')) withTM++;
  });
  console.log('Peter_AD recent batches:', anyBatches, '— with TM rows:', withTM);
  console.log('Category code distribution across his attempted_upserts:', cats);
})();
