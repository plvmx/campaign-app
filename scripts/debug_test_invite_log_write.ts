/**
 * One-off diagnostic — confirms the service role can actually write to
 * registry.whatsapp_invite_log (inserts a clearly-marked test row, then
 * deletes it immediately). Not part of the app.
 *
 * This is what actually found the bug (2026-09-17): the insert failed
 * with `permission denied for sequence whatsapp_invite_log_id_seq`
 * (42501) — the table's `id` column was BIGSERIAL rather than this
 * schema's usual GENERATED ALWAYS AS IDENTITY, so service_role had never
 * been granted its backing sequence. See
 * fix_whatsapp_invite_log_sequence_grant.sql for the fix and full
 * writeup. Re-run this after applying that fix to confirm it resolves —
 * expect "INSERT SUCCEEDED" instead.
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

// A real existing registrant id, used only to satisfy the FK — this test
// never touches that registrant's own data.
const TEST_REGISTRANT_ID = 'b37b956b-eaa7-45cf-8cde-83676e478fb9';

async function main() {
  const { data, error } = await supabase.schema('registry').from('whatsapp_invite_log').insert({
    registrant_id: TEST_REGISTRANT_ID,
    raw_staging_id: null,
    status: 'failed',
    error: 'DIAGNOSTIC TEST ROW - safe to ignore/delete',
    resend_message_id: null,
    included_campaigns_near_me_link: false,
  }).select('id').single();

  if (error) {
    console.log('INSERT FAILED:', JSON.stringify(error, null, 2));
    process.exit(1);
  }
  console.log('INSERT SUCCEEDED, id =', data.id);

  const { error: delErr } = await supabase.schema('registry').from('whatsapp_invite_log').delete().eq('id', data.id);
  if (delErr) {
    console.log('CLEANUP DELETE FAILED (please manually delete id', data.id, '):', delErr.message);
  } else {
    console.log('Cleanup delete succeeded — test row removed.');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
