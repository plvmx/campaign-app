/**
 * Creates member portal sign-in links (docs/member-portal/SIGN_IN_DESIGN.md §4)
 * for named registrants — the pilot tool (a bulk, batched, emailed version is a
 * later step). A link only tells the sign-in page WHICH registrant to show
 * (masked details); opening it proves nothing, and the person still has to type
 * the code emailed to them and the code texted to them. Only a hash of the token
 * is stored, so a link can be shown once — if one is lost, make a new one.
 *
 * DRY RUN BY DEFAULT: prints what it would do for each email (found / not found /
 * cannot sign in / already has a live link) and creates nothing. Pass --apply to
 * create links; they are printed once, at the end.
 *
 * Usage:
 *   npx tsx scripts/create_member_invite.ts --email=jane@example.com
 *   npx tsx scripts/create_member_invite.ts --email="a@x.com,b@y.com" --base-url=https://<preview-or-site>
 *   npx tsx scripts/create_member_invite.ts --email=jane@example.com --base-url=https://... --apply
 *
 * Options:
 *   --email=       one or more addresses (comma/space separated) of EXISTING registrants
 *   --base-url=    where the link points (https://… , or http://localhost:3000). Falls back to
 *                  NEXT_PUBLIC_SITE_URL; with neither, the script refuses rather than guess a host.
 *   --days=N       how long a link works (default 90, max 365)
 *   --replace      revoke a registrant's existing live links and issue a fresh one (default: skip them)
 *   --apply        actually create the links
 *
 * Needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (read from .env.local).
 * Treat the printed links like login hints: send each only to its own person.
 */
import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import { createMemberInvite } from '../lib/services/memberAuthService';
import { buildInviteLink, parseEmailList, planMemberInvites, type RegistrantForInvite } from '../lib/memberInvitePlan';
import { getErrorMessage } from '../lib/errorUtils';

const envPath = path.join(__dirname, '..', '.env.local');
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf-8').split('\n').forEach((line) => {
    const t = line.trim();
    if (!t || t.startsWith('#')) return;
    const [k, ...rest] = t.split('=');
    if (k && rest.length && process.env[k.trim()] === undefined) {
      process.env[k.trim()] = rest.join('=').trim().replace(/^["']|["']$/g, '');
    }
  });
}

const args = process.argv.slice(2);
const flag = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const APPLY = args.includes('--apply');
const REPLACE = args.includes('--replace');

function fail(message: string): never {
  console.error(`✖ ${message}`);
  process.exit(1);
}

async function main() {
  const emailArg = flag('email');
  if (!emailArg) fail('Give at least one registrant with --email=jane@example.com');
  const baseUrl = flag('base-url') ?? process.env.NEXT_PUBLIC_SITE_URL;
  if (!baseUrl) fail('Give --base-url=https://… (or set NEXT_PUBLIC_SITE_URL) — this script will not guess where links should point.');
  const daysRaw = flag('days');
  const days = daysRaw === undefined ? 90 : Number(daysRaw);
  if (!Number.isInteger(days) || days < 1 || days > 365) fail('--days must be a whole number from 1 to 365.');

  let emails: string[];
  try {
    emails = parseEmailList(emailArg);
    buildInviteLink(baseUrl, 'check'); // validate the base before touching the database
  } catch (err) {
    fail(getErrorMessage(err));
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) fail('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (.env.local).');
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const registry = client.schema('registry');

  const { data: registrants, error: regError } = await registry
    .from('registrants')
    .select('id, first_name, email, phone, unsubscribed, nfc')
    .in('email', emails);
  if (regError) fail(`Registrant lookup failed: ${regError.message}`);
  const found = (registrants ?? []) as RegistrantForInvite[];

  const liveInviteCounts: Record<string, number> = {};
  if (found.length > 0) {
    const { data: invites, error: invError } = await registry
      .from('member_invites')
      .select('registrant_id')
      .in('registrant_id', found.map((r) => r.id))
      .is('revoked_at', null)
      .gt('expires_at', new Date().toISOString());
    if (invError) fail(`Invite lookup failed: ${invError.message}`);
    for (const row of (invites ?? []) as { registrant_id: string }[]) {
      liveInviteCounts[row.registrant_id] = (liveInviteCounts[row.registrant_id] ?? 0) + 1;
    }
  }

  const plan = planMemberInvites({ emails, registrants: found, liveInviteCounts, replace: REPLACE });

  console.log(`${APPLY ? 'APPLYING' : 'DRY RUN'} — ${plan.length} address(es), links valid ${days} days, pointing at ${new URL(baseUrl).origin}\n`);
  for (const p of plan) {
    switch (p.status) {
      case 'create': console.log(`  ✔ ${p.email}: will create a link${p.notes.length ? ` (note: ${p.notes.join(', ')})` : ''}`); break;
      case 'replace': console.log(`  ↻ ${p.email}: will revoke ${p.existing} live link(s) and create a new one${p.notes.length ? ` (note: ${p.notes.join(', ')})` : ''}`); break;
      case 'skip_existing': console.log(`  – ${p.email}: already has ${p.existing} live link(s) — skipped (use --replace for a fresh one)`); break;
      case 'not_found': console.log(`  ✖ ${p.email}: no registrant with this email`); break;
      case 'ineligible': console.log(`  ✖ ${p.email}: cannot sign in by themselves (${p.reason === 'no_mobile' ? 'no mobile number on file' : 'no usable email on file'})`); break;
    }
  }

  const toCreate = plan.filter((p) => p.status === 'create' || p.status === 'replace');
  if (!APPLY) {
    console.log(`\nNothing created. ${toCreate.length} link(s) would be made — re-run with --apply.`);
    return;
  }

  const issued: { email: string; firstName: string | null; link: string }[] = [];
  for (const p of toCreate) {
    if (p.status !== 'create' && p.status !== 'replace') continue;
    try {
      if (p.status === 'replace') {
        const { error } = await registry
          .from('member_invites')
          .update({ revoked_at: new Date().toISOString() })
          .eq('registrant_id', p.registrantId)
          .is('revoked_at', null);
        if (error) throw new Error(`revoking old links failed: ${error.message}`);
      }
      const token = await createMemberInvite(client, {}, p.registrantId, days);
      issued.push({ email: p.email, firstName: p.firstName, link: buildInviteLink(baseUrl, token) });
    } catch (err) {
      console.error(`  ✖ ${p.email}: ${getErrorMessage(err)}`);
    }
  }

  console.log(`\nCreated ${issued.length} of ${toCreate.length} link(s). They are shown ONCE — only a hash is stored:\n`);
  for (const i of issued) console.log(`${i.firstName ?? i.email} <${i.email}>\n  ${i.link}\n`);
  if (issued.length < toCreate.length) process.exitCode = 1;
}

main().catch((err) => fail(getErrorMessage(err)));
