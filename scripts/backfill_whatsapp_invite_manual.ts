/**
 * Manual backfill — sends the WhatsApp group invite email to registrants
 * who registered before registry.whatsapp_group_links' 'national' row was
 * configured (2026-09-15), and so never had it sent to them by ac-sync's
 * normal isNew-triggered flow (lib/registryPipeline/transform.ts).
 *
 * Peter's call (2026-09-17): scope this to a configurable recent window
 * (default: the last 14 days by `registered_at`, i.e. the AC/CSV-reported
 * registration date, not first_seen_at) rather than the full ~6,301-person
 * population going back to 2017 — a full historical mass-send is a much
 * bigger, separate decision (deliverability/reputation risk, WhatsApp
 * group capacity) that hasn't been made. Pass --since to override the
 * window with a specific cutoff date instead.
 *
 * DRY RUN BY DEFAULT — prints the exact candidate list and does nothing
 * else. Pass --apply to actually send. Safe to re-run: only registrants
 * with no existing status='sent' row in registry.whatsapp_invite_log are
 * considered candidates, so a re-run after a partial failure only retries
 * the ones that failed (or were never attempted), never double-sends to
 * someone already confirmed sent.
 *
 * Reuses the exact same email content (lib/registryPipeline/whatsappInvite.ts)
 * and logs to registry.whatsapp_invite_log exactly like the automated
 * pipeline does, so this backfill's history shows up in
 * /registry/manage/whatsapp-invite-log alongside everything else —
 * raw_staging_id is simply null for these rows, since they're not tied to
 * any staging.ac_events sync.
 *
 * Usage:
 *   npx tsx scripts/backfill_whatsapp_invite_manual.ts                     # dry run, last 14 days
 *   npx tsx scripts/backfill_whatsapp_invite_manual.ts --since=2026-09-01  # dry run, custom cutoff
 *   RESEND_API_KEY=... npx tsx scripts/backfill_whatsapp_invite_manual.ts --since=2026-09-01 --apply
 *
 * RESEND_API_KEY is an ac-sync Edge Function secret, not something this
 * repo's .env.local carries — pass it inline on the command line as shown
 * above (never paste it into chat). NEXT_PUBLIC_SITE_URL defaults to the
 * confirmed production domain below if not set in the environment; pass
 * it explicitly to override.
 */
import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import { buildWhatsAppInviteEmail } from '../lib/registryPipeline/whatsappInvite';
import { getErrorMessage } from '../lib/errorUtils';

const envPath = path.join(__dirname, '..', '.env.local');
fs.readFileSync(envPath, 'utf-8').split('\n').forEach((line) => {
  const t = line.trim();
  if (!t || t.startsWith('#')) return;
  const [k, ...rest] = t.split('=');
  // Don't clobber a value already set on the actual process env (e.g. a
  // RESEND_API_KEY passed inline on the command line) with .env.local's.
  if (k && rest.length && process.env[k.trim()] === undefined) {
    process.env[k.trim()] = rest.join('=').trim().replace(/^["']|["']$/g, '');
  }
});

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const sinceArg = args.find((a) => a.startsWith('--since='))?.split('=')[1];
const SINCE = sinceArg ? new Date(sinceArg) : new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
if (Number.isNaN(SINCE.getTime())) {
  console.error(`Invalid --since date: ${sinceArg}`);
  process.exit(1);
}

const RESEND_API_URL = 'https://api.resend.com/emails';
const FROM_ADDRESS = 'AFJ <noreply@afj.org.au>';
// Confirmed production domain (docs/registry-pipeline/OPERATIONS.md) — used
// only as a default when NEXT_PUBLIC_SITE_URL isn't set in the environment.
const DEFAULT_SITE_URL = 'https://campaign.afj.org.au';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

interface Candidate {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string;
  state: string | null;
  registered_at: string | null;
}

async function getCandidates(): Promise<Candidate[]> {
  const { data: registrants, error } = await supabase
    .schema('registry')
    .from('registrants')
    .select('id, first_name, last_name, email, state, registered_at, unsubscribed')
    .not('email', 'is', null)
    .gte('registered_at', SINCE.toISOString())
    .order('registered_at', { ascending: true });
  if (error) throw error;

  // registry.registrants.unsubscribed is 'Yes' or null. Deliberately NOT
  // filtered via .neq('unsubscribed', 'Yes') in the query above — Postgres's
  // three-valued logic means `unsubscribed <> 'Yes'` evaluates to NULL (not
  // true) for a NULL row, so a plain .neq() would silently exclude every
  // non-unsubscribed registrant along with the unsubscribed ones (confirmed
  // live: that exact mistake returned zero rows here, including Nimmy Joy,
  // who has unsubscribed: null). Filtered in JS instead, where null-vs-'Yes'
  // is unambiguous.
  const notUnsubscribed = (registrants ?? []).filter((r) => r.unsubscribed !== 'Yes');

  const { data: alreadySent, error: sentErr } = await supabase
    .schema('registry')
    .from('whatsapp_invite_log')
    .select('registrant_id')
    .eq('status', 'sent');
  if (sentErr) throw sentErr;
  const sentIds = new Set((alreadySent ?? []).map((r) => r.registrant_id));

  return notUnsubscribed
    .filter((r) => !sentIds.has(r.id))
    .map((r) => ({ id: r.id, first_name: r.first_name, last_name: r.last_name, email: r.email as string, state: r.state, registered_at: r.registered_at }));
}

async function sendOne(c: Candidate, inviteUrl: string, siteUrl: string | null): Promise<{ resendMessageId: string; includedCampaignsNearMeLink: boolean }> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error('RESEND_API_KEY is not set');

  const campaignsNearMeUrl = siteUrl ? `${siteUrl}/public/campaigns-near-me?r=${encodeURIComponent(c.id)}` : null;
  const { subject, html, text } = buildWhatsAppInviteEmail(c.first_name, inviteUrl, campaignsNearMeUrl);

  const res = await fetch(RESEND_API_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM_ADDRESS, to: [c.email], subject, html, text }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Resend API error ${res.status}: ${body}`);
  }
  const data = (await res.json()) as { id?: string };
  return { resendMessageId: data.id ?? '', includedCampaignsNearMeLink: campaignsNearMeUrl !== null };
}

async function logAttempt(registrantId: string, outcome: { status: 'sent' | 'failed'; error?: string; resendMessageId?: string; includedCampaignsNearMeLink?: boolean }) {
  const { error } = await supabase.schema('registry').from('whatsapp_invite_log').insert({
    registrant_id: registrantId,
    raw_staging_id: null,
    status: outcome.status,
    error: outcome.error ?? null,
    resend_message_id: outcome.resendMessageId ?? null,
    included_campaigns_near_me_link: outcome.includedCampaignsNearMeLink ?? false,
  });
  if (error) console.error(`  (failed to write whatsapp_invite_log row for ${registrantId}):`, error.message);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log(`Cutoff (--since): registered_at >= ${SINCE.toISOString()}`);
  console.log(`Mode: ${APPLY ? 'APPLY (will actually send + log)' : 'DRY RUN (no emails sent, nothing logged)'}\n`);

  const { data: link, error: linkErr } = await supabase
    .schema('registry').from('whatsapp_group_links').select('invite_url').eq('group_key', 'national').maybeSingle();
  if (linkErr) throw linkErr;
  if (!link?.invite_url) {
    console.error('No national invite link configured in registry.whatsapp_group_links — nothing to send.');
    process.exit(1);
  }

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? DEFAULT_SITE_URL;
  const candidates = await getCandidates();

  console.log(`Candidates (registered since cutoff, has email, not unsubscribed, never sent): ${candidates.length}\n`);
  for (const c of candidates) {
    console.log(`- ${c.first_name ?? ''} ${c.last_name ?? ''} <${c.email}> (${c.state ?? 'no state'}) — registered ${c.registered_at}`);
  }

  if (!APPLY) {
    console.log('\nDry run only — pass --apply (with RESEND_API_KEY set) to actually send these.');
    return;
  }

  if (candidates.length === 0) {
    console.log('\nNothing to send.');
    return;
  }

  console.log(`\nSending to ${candidates.length} candidate(s), pacing ~3/sec...\n`);
  let sent = 0;
  let failed = 0;
  for (const c of candidates) {
    try {
      const result = await sendOne(c, link.invite_url, siteUrl);
      await logAttempt(c.id, { status: 'sent', resendMessageId: result.resendMessageId, includedCampaignsNearMeLink: result.includedCampaignsNearMeLink });
      console.log(`  sent -> ${c.email} (${result.resendMessageId})`);
      sent++;
    } catch (err) {
      const message = getErrorMessage(err);
      await logAttempt(c.id, { status: 'failed', error: message });
      console.log(`  FAILED -> ${c.email}: ${message}`);
      failed++;
    }
    await sleep(300);
  }

  console.log(`\nDone. Sent: ${sent}, Failed: ${failed}. Check /registry/manage/whatsapp-invite-log for the full record.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
