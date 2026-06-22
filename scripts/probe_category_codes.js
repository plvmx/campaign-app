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
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY);

(async () => {
  // 1. What codes are present in the table now?
  const { data: existing } = await admin.from('results').select('category_code');
  const dist = {};
  (existing || []).forEach((r) => { dist[r.category_code] = (dist[r.category_code] || 0) + 1; });
  console.log('Distinct category_code values currently in the table:');
  Object.entries(dist).forEach(([k, v]) => console.log(`  ${k}: ${v}`));

  // 2. Sign in and test each app-used code individually
  const { data: s } = await anon.auth.signInAnonymously();
  const uid = s.user.id;
  const cid = '0ed573b9-ddc6-4f2c-9080-067a82645cc9';
  console.log('\nTesting each app-used category code via anon insert:');
  for (const code of ['TM', 'P', 'F', 'SP', 'IR']) {
    const { data, error } = await anon.from('results').insert({
      campaign_id: cid, first_name: '__probe__', category_code: code, user_id: uid,
    }).select('id');
    if (error) {
      console.log(`  ${code}: REJECTED — ${error.code} ${error.message}`);
    } else {
      console.log(`  ${code}: accepted`);
      if (data && data[0]) await admin.from('results').delete().eq('id', data[0].id);
    }
  }
  await admin.auth.admin.deleteUser(uid).catch(() => {});
})();
