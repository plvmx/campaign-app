/* Try to insert into results using the ANON key (no service role). The anon
 * client has auth.uid() = null and should be rejected by RLS with a clear
 * message — which tells us whether the INSERT policy actually exists and
 * what message it produces. We can compare that to what real users hit. */
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
const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

(async () => {
  console.log('Anon insert attempt (should be rejected if RLS is enabled):');
  const { data, error } = await anon.from('results').insert({
    campaign_id:   '0ed573b9-ddc6-4f2c-9080-067a82645cc9',
    first_name:    '__diagnostic_anon__',
    category_code: 'TM',
    user_id:       '61d9b175-3145-4211-b7d9-76e92b08ebb6', // Sarah's id
  }).select('id, first_name, category_code');
  console.log('  error:', error);
  console.log('  data:',  data);

  console.log('\nAnon SELECT attempt:');
  const { data: s, error: serr } = await anon.from('results').select('id').limit(1);
  console.log('  error:', serr);
  console.log('  data:',  s);
})();
