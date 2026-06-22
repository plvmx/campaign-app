/* Sign in anonymously (the same way regular leaders do via signInWithMobileAndName)
 * and try to insert a row into `results`. This reproduces what Sarah/Bee Bee/etc.
 * actually experience. The service-role probe earlier could not reach RLS state
 * because it bypasses RLS. */
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
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const anon = createClient(url, anonKey, { auth: { persistSession: false } });
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY);

(async () => {
  console.log('Signing in anonymously...');
  const { data: signin, error: signinErr } = await anon.auth.signInAnonymously();
  if (signinErr) { console.error('signin error:', signinErr); return; }
  const userId = signin.user.id;
  console.log('  anonymous user.id =', userId);
  console.log('  is_anonymous claim:', signin.user.is_anonymous);

  const cid = '0ed573b9-ddc6-4f2c-9080-067a82645cc9';

  console.log('\nAttempting INSERT into results (matching Sarah\'s shape)...');
  const { data, error } = await anon.from('results').insert({
    campaign_id:   cid,
    first_name:    '__diagnostic_repro__',
    category_code: 'TM',
    user_id:       userId,
  }).select('id, first_name, category_code');
  if (error) {
    console.log('  REJECTED — code:', error.code, '/ message:', error.message);
  } else {
    console.log('  ACCEPTED — inserted:', data);
    if (data && data[0]) await admin.from('results').delete().eq('id', data[0].id);
  }

  console.log('\nAttempting INSERT into results_changes_log (for comparison)...');
  const { data: ld, error: le } = await anon.from('results_changes_log').insert({
    campaign_id: cid,
    user_id:     userId,
    status:      'SUCCESS',
    attempted_upserts: [],
    attempted_deletes: [],
    user_email: null,
    user_name:  '__diagnostic__',
  }).select('id');
  if (le) {
    console.log('  REJECTED — code:', le.code, '/ message:', le.message);
  } else {
    console.log('  ACCEPTED — inserted:', ld);
    if (ld && ld[0]) await admin.from('results_changes_log').delete().eq('id', ld[0].id);
  }

  // Clean up the anonymous auth user we created
  await admin.auth.admin.deleteUser(userId).catch(() => {});
})();
