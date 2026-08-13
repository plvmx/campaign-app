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
  const { data, error } = await supabase
    .from('state_leaders')
    .select('id, state, leader, mobile, admin')
    .not('admin', 'is', null);
  if (error) { console.error('Error:', error); return; }
  const valid = data.filter((r) => r.admin === 'AD' || r.admin === 'SR');
  const bad = data.filter((r) => r.admin !== 'AD' && r.admin !== 'SR');
  console.log(`Total non-null admin rows: ${data.length}`);
  console.log(`Valid (AD/SR): ${valid.length}`);
  console.log(`Bad (other values): ${bad.length}`);
  console.log('Bad rows:', JSON.stringify(bad, null, 2));
})();
