/**
 * One-off — retroactively logs the two invite emails that were confirmed
 * (by Peter, checking Resend's own dashboard, 2026-09-17) to have actually
 * sent successfully during the window when registry.whatsapp_invite_log's
 * insert was silently failing (the BIGSERIAL sequence-grant bug, fixed in
 * fix_whatsapp_invite_log_sequence_grant.sql). Without this, the log stays
 * permanently missing these two real sends, and — more importantly — the
 * manual backfill tool (backfill_whatsapp_invite_manual.ts) would have no
 * way to know they were already sent and would send them a duplicate.
 *
 * resend_message_id is left null — Peter confirmed via Resend's dashboard
 * UI, not an API lookup, so no message id was captured; not worth an API
 * round-trip just to backfill a field that's otherwise informational only.
 *
 * Not part of the app. Safe to re-run (skips a registrant that already
 * has a 'sent' row).
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

// Confirmed via Resend dashboard by Peter, 2026-09-17.
const CONFIRMED_SENT = [
  { email: 'sathwik.v75@gmail.com', note: 'sathwik valla' },
  { email: 'eztherwlc@gmail.com', note: 'Esther Wong' },
];

async function main() {
  for (const { email, note } of CONFIRMED_SENT) {
    const { data: registrant, error: findErr } = await supabase
      .schema('registry').from('registrants').select('id').eq('email', email).maybeSingle();
    if (findErr) throw findErr;
    if (!registrant) {
      console.log(`SKIP ${note} <${email}>: no matching registrant found`);
      continue;
    }

    const { data: existing, error: existingErr } = await supabase
      .schema('registry').from('whatsapp_invite_log').select('id').eq('registrant_id', registrant.id).eq('status', 'sent').maybeSingle();
    if (existingErr) throw existingErr;
    if (existing) {
      console.log(`SKIP ${note} <${email}>: already has a 'sent' row (id ${existing.id})`);
      continue;
    }

    const { error: insertErr } = await supabase.schema('registry').from('whatsapp_invite_log').insert({
      registrant_id: registrant.id,
      raw_staging_id: null,
      status: 'sent',
      error: null,
      resend_message_id: null,
      included_campaigns_near_me_link: true, // NEXT_PUBLIC_SITE_URL was configured well before this send
    });
    if (insertErr) throw insertErr;
    console.log(`LOGGED ${note} <${email}> as sent (retroactive, confirmed via Resend dashboard)`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
