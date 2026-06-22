/* Read-only investigation for the Charters Towers / Sarah / 20 June 11am case. */
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
  // 1. Find campaign(s) matching the description (be loose on capitalisation).
  console.log('--- Looking for the campaign ---');
  const { data: candidates, error: cErr } = await supabase
    .from('campaigns')
    .select('*')
    .ilike('place', '%charter%')
    .order('date', { ascending: false });
  if (cErr) { console.error(cErr); process.exit(1); }
  console.log(`Found ${candidates.length} campaigns with place ~ 'charter':`);
  candidates.forEach((c) => {
    console.log(`  id=${c.id}  date=${c.date}  time=${c.time}  place=${c.place}  state=${c.state}  leader=${c.leader}  actual_leader=${c.actual_leader}`);
  });

  // 2. Narrow to the exact campaign (20 June or near, leader contains Sarah)
  const matches = candidates.filter((c) => {
    const dateOk = String(c.date || '').includes('2026-06-20') || String(c.date || '').includes('2025-06-20') || String(c.date || '').includes('06-20');
    const leaderOk = /sarah/i.test(c.leader || '') || /sarah/i.test(c.actual_leader || '');
    return dateOk && leaderOk;
  });
  console.log(`\nNarrowed to ${matches.length} matching campaigns (date≈20 June, leader=Sarah):`);
  for (const m of matches) {
    console.log(`\n=== Campaign ${m.id} ===`);
    console.log('  ', m);

    // 3. Results currently in the table for this campaign
    const { data: results } = await supabase
      .from('results')
      .select('id, first_name, category_code, created_at, user_id')
      .eq('campaign_id', m.id)
      .order('created_at', { ascending: true });
    console.log(`  results rows: ${results?.length || 0}`);
    (results || []).forEach((r) => console.log(`    [${r.category_code}] ${r.first_name}  (id=${r.id.slice(0, 8)}…  created=${r.created_at})`));

    // 4. Audit log entries for this campaign
    const { data: logs, error: lErr } = await supabase
      .from('results_changes_log')
      .select('id, status, attempted_upserts, attempted_deletes, error_message, user_email, user_name, created_at')
      .eq('campaign_id', m.id)
      .order('created_at', { ascending: true });
    if (lErr) {
      console.log(`  results_changes_log query error: ${lErr.message}`);
    } else {
      console.log(`  results_changes_log entries: ${logs.length}`);
      logs.forEach((l) => {
        const ups = (l.attempted_upserts || []).map((u) => `${u.first_name}/${u.category_code}`).join(', ');
        const dels = (l.attempted_deletes || []).map((u) => `${u.first_name}/${u.category_code}`).join(', ');
        console.log(`    ${l.created_at}  ${l.status}  user=${l.user_name}  ups=[${ups}]  dels=[${dels}]  err=${l.error_message || ''}`);
      });
    }

    // 5. record_results_save_error telemetry for this user
    if (logs && logs.length) {
      const userIds = [...new Set(logs.map((l) => null).filter(Boolean))];
      void userIds;
    }
    const { data: errEvents } = await supabase
      .from('app_events')
      .select('user_name, event_type, event_data, created_at')
      .eq('event_type', 'record_results_save_error')
      .gte('created_at', new Date(Date.now() - 1000 * 60 * 60 * 24 * 7).toISOString())
      .order('created_at', { ascending: true });
    if (errEvents && errEvents.length) {
      console.log(`\n  record_results_save_error events in last 7 days (any user):`);
      errEvents.forEach((e) => console.log(`    ${e.created_at}  user=${e.user_name}  data=${JSON.stringify(e.event_data)}`));
    } else {
      console.log(`\n  No record_results_save_error events in last 7 days.`);
    }
  }

  if (matches.length === 0) {
    console.log('\nNo exact match. Showing all recent app_events with errors for context:');
    const { data: errs } = await supabase
      .from('app_events')
      .select('user_name, event_type, event_data, created_at')
      .eq('event_type', 'record_results_save_error')
      .order('created_at', { ascending: false })
      .limit(20);
    (errs || []).forEach((e) => console.log(`  ${e.created_at}  user=${e.user_name}  data=${JSON.stringify(e.event_data)}`));
  }
})().catch((e) => { console.error(e); process.exit(1); });
