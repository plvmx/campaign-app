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
  // 1. Find Sarah's user_id and any of her successful audit log entries
  const { data: sarahLogs } = await supabase
    .from('results_changes_log')
    .select('user_id, user_email, status, campaign_id, created_at, attempted_upserts')
    .eq('user_name', 'Sarah')
    .order('created_at', { ascending: false })
    .limit(50);
  const sarahUserId = sarahLogs?.[0]?.user_id;
  console.log('Sarah user_id (from latest audit log entry):', sarahUserId);
  console.log('Sarah email:', sarahLogs?.[0]?.user_email);

  const successes = (sarahLogs || []).filter((l) => l.status === 'SUCCESS');
  const failures  = (sarahLogs || []).filter((l) => l.status === 'ERROR');
  console.log(`\nSarah's recent activity: ${successes.length} SUCCESS, ${failures.length} ERROR (in last 50 entries)`);

  // 2. Has Sarah ever successfully written ANY results row?
  if (sarahUserId) {
    const { data: written, count } = await supabase
      .from('results')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', sarahUserId);
    console.log(`Results rows where user_id = Sarah's id: ${count ?? '(unknown)'}`);
  }

  // 3. The Charters Twrs campaign — who owns it, and what's Sarah's state?
  const cid = '0ed573b9-ddc6-4f2c-9080-067a82645cc9';
  const { data: campaign } = await supabase.from('campaigns').select('*').eq('id', cid).single();
  console.log('\nCampaign:', campaign);
  console.log('Campaign user_id (owner):', campaign?.user_id);
  console.log('Same as Sarah\'s user_id?', campaign?.user_id === sarahUserId);

  // 4. Sarah's state_leaders record
  if (sarahUserId) {
    const { data: leaderRows } = await supabase.from('state_leaders').select('*').or(`mobile.eq.${campaign?.mobile || 'x'},leader.ilike.Sarah%`);
    console.log('\nstate_leaders rows matching Sarah/mobile:');
    (leaderRows || []).forEach((l) => console.log('  ', l));
  }

  // 5. user_profiles for Sarah
  if (sarahUserId) {
    const { data: profile } = await supabase.from('user_profiles').select('*').eq('user_id', sarahUserId).single();
    console.log('\nuser_profiles for Sarah:', profile);
  }
})();
