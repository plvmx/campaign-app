/* Read-only: list constraints, columns and indexes on the `results` table. */
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
try { require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') }); }
catch {
  const envPath = path.join(__dirname, '..', '.env.local');
  if (fs.existsSync(envPath)) {
    fs.readFileSync(envPath, 'utf-8').split('\n').forEach((line) => {
      const t = line.trim();
      if (!t || t.startsWith('#')) return;
      const [k, ...rest] = t.split('=');
      if (k && rest.length) process.env[k.trim()] = rest.join('=').trim().replace(/^["']|["']$/g, '');
    });
  }
}
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

(async () => {
  // Pull one row to see what columns the API exposes (and therefore what's stored).
  const { data: sample, error: sampleErr } = await supabase.from('results').select('*').limit(1);
  if (sampleErr) { console.error('sample error:', sampleErr); process.exit(1); }
  console.log('Sample row columns:', sample[0] ? Object.keys(sample[0]) : '(no rows)');
  console.log('Sample row:', sample[0] || '(none)');

  const { count } = await supabase.from('results').select('*', { count: 'exact', head: true });
  console.log('Total rows:', count);
})().catch((e) => { console.error(e); process.exit(1); });
