const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const envPath = path.join(__dirname, '..', '.env.local');
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf-8').split('\n').forEach((line) => {
    const t = line.trim();
    if (!t || t.startsWith('#')) return;
    const [k, ...rest] = t.split('=');
    if (k && rest.length) process.env[k.trim()] = rest.join('=').trim().replace(/^["']|["']$/g, '');
  });
}
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

(async () => {
  // Pick one existing campaign + try to duplicate one of its existing rows.
  const { data: existing } = await supabase.from('results').select('*').limit(1);
  if (!existing || !existing.length) { console.log('no rows'); return; }
  const r = existing[0];
  console.log('Trying to insert duplicate of:', { campaign_id: r.campaign_id, first_name: r.first_name, category_code: r.category_code });
  const { data, error } = await supabase.from('results').insert({
    campaign_id: r.campaign_id,
    first_name: r.first_name,
    category_code: r.category_code,
    user_id: r.user_id,
  }).select();
  if (error) {
    console.log('GOT EXPECTED ERROR:');
    console.log('  message:', error.message);
    console.log('  details:', error.details);
    console.log('  hint:', error.hint);
    console.log('  code:', error.code);
  } else {
    console.log('Insert succeeded (no unique constraint!):', data);
    // clean up
    if (data && data[0] && data[0].id) {
      await supabase.from('results').delete().eq('id', data[0].id);
      console.log('cleaned up test row');
    }
  }
})();
