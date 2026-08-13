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
    .or('mobile.eq.0418973668,leader.ilike.%lim%');
  if (error) { console.error('Error:', error); return; }
  console.log('Matches:', JSON.stringify(data, null, 2));
})();
