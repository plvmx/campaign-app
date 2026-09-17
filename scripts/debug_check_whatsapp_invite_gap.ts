/**
 * One-off diagnostic — Peter reported new registrations in the last 24h
 * with no rows appearing in registry.whatsapp_invite_log. Checks the
 * failure shape (aggregate first) before digging into any single record.
 *
 * Outcome (2026-09-17): sync_log/staging.ac_events showed ac-sync running
 * normally with no errors, and registry.whatsapp_group_links' national
 * row was genuinely configured — ruling out the obvious explanations.
 * whatsapp_invite_log itself was found to have zero rows, ever (not just
 * in the 24h window). Root cause found by debug_test_invite_log_write.ts:
 * the table's `id` column was BIGSERIAL instead of this schema's usual
 * GENERATED ALWAYS AS IDENTITY, so service_role had never been granted
 * its backing sequence — every insert failed silently with `permission
 * denied for sequence ..._id_seq`, swallowed by transform.ts's own
 * console-error-only safety net around the log write. Fixed by
 * fix_whatsapp_invite_log_sequence_grant.sql. Not part of the app.
 */
import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';

const envPath = path.join(__dirname, '..', '.env.local');
fs.readFileSync(envPath, 'utf-8').split('\n').forEach((line) => {
  const t = line.trim();
  if (!t || t.startsWith('#')) return;
  const [k, ...rest] = t.split('=');
  if (k && rest.length) process.env[k.trim()] = rest.join('=').trim().replace(/^["']|["']$/g, '');
});

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

const SINCE = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

async function main() {
  console.log(`Window: since ${SINCE}\n`);

  console.log('=== registry.registrants — columns actually present ===');
  const { data: sampleRow, error: sampleErr } = await supabase.schema('registry').from('registrants').select('*').limit(1);
  if (sampleErr) throw sampleErr;
  console.log(Object.keys(sampleRow?.[0] ?? {}));

  console.log('=== registry.sync_log — runs in the last 24h ===');
  const { data: syncRuns, error: syncErr } = await supabase
    .schema('registry')
    .from('sync_log')
    .select('id, run_type, started_at, completed_at, status, records_in, records_upserted, errors, notes')
    .gte('started_at', SINCE)
    .order('started_at', { ascending: false });
  if (syncErr) throw syncErr;
  console.log(JSON.stringify(syncRuns, null, 2));

  console.log('\n=== registry.whatsapp_group_links — is the national link actually configured? ===');
  const { data: link, error: linkErr } = await supabase
    .schema('registry')
    .from('whatsapp_group_links')
    .select('*')
    .eq('group_key', 'national')
    .maybeSingle();
  if (linkErr) throw linkErr;
  console.log(JSON.stringify(link, null, 2));

  console.log('\n=== registry.registrants — genuinely new rows (first_seen_at) in the last 24h ===');
  const { data: registrants, error: regErr } = await supabase
    .schema('registry')
    .from('registrants')
    .select('id, first_name, last_name, email, phone, state, registered_at, first_seen_at, last_updated_at, unsubscribed')
    .gte('first_seen_at', SINCE)
    .order('first_seen_at', { ascending: false });
  if (regErr) throw regErr;
  console.log(`Count: ${registrants?.length ?? 0}`);
  console.log(JSON.stringify(registrants, null, 2));

  console.log('\n=== registry.whatsapp_invite_log — total row count, all time ===');
  const { count: totalLogCount, error: totalLogErr } = await supabase
    .schema('registry')
    .from('whatsapp_invite_log')
    .select('id', { count: 'exact', head: true });
  if (totalLogErr) throw totalLogErr;
  console.log(`Total rows ever: ${totalLogCount}`);

  console.log('\n=== registry.whatsapp_invite_log — rows in the last 24h ===');
  const { data: inviteLog, error: inviteErr } = await supabase
    .schema('registry')
    .from('whatsapp_invite_log')
    .select('*')
    .gte('attempted_at', SINCE)
    .order('attempted_at', { ascending: false });
  if (inviteErr) throw inviteErr;
  console.log(`Count: ${inviteLog?.length ?? 0}`);
  console.log(JSON.stringify(inviteLog, null, 2));

  console.log('\n=== registry.registration_events — events in the last 24h ===');
  const { data: events, error: eventsErr } = await supabase
    .schema('registry')
    .from('registration_events')
    .select('id, registrant_id, source_list_id, source_tag, event_type, raw_staging_id, occurred_at')
    .gte('occurred_at', SINCE)
    .order('occurred_at', { ascending: false });
  if (eventsErr) console.log('(registration_events query failed):', eventsErr.message);
  else {
    console.log(`Count: ${events?.length ?? 0}`);
    console.log(JSON.stringify(events, null, 2));
  }

  console.log('\n=== staging.ac_events — most recent 5 rows received (is ac-sync even pulling new data?) ===');
  const { data: staging, error: stagingErr } = await supabase
    .schema('staging')
    .from('ac_events')
    .select('id, source_list_id, ac_contact_id, event_type, received_at, processed_at, processing_error')
    .order('received_at', { ascending: false })
    .limit(5);
  if (stagingErr) throw stagingErr;
  console.log(JSON.stringify(staging, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
