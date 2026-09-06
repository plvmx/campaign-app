/**
 * Admin utility — removes a registry portal user's TOTP factor(s),
 * verified or not, so they see the enrollment (QR code) screen again on
 * their next sign-in instead of the challenge screen.
 *
 * Uses the same access-token trick as scripts/debug_totp_enroll_response.ts:
 * generates a real magic link server-side and follows its verify redirect
 * to pull an access_token straight out of the Location header, then acts
 * on the user's own factors via the normal (non-admin) REST endpoints —
 * there's no admin-level "remove this user's MFA" API, since MFA factors
 * belong to the user's own session context.
 *
 * Usage:
 *   npx tsx scripts/unenroll_registry_mfa_totp.ts <email>          # dry-run, lists factors
 *   npx tsx scripts/unenroll_registry_mfa_totp.ts <email> --apply  # actually deletes them
 */
import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import { getSiteUrl } from '../lib/siteUrl';

const envPath = path.join(__dirname, '..', '.env.local');
fs.readFileSync(envPath, 'utf-8').split('\n').forEach((line) => {
  const t = line.trim();
  if (!t || t.startsWith('#')) return;
  const [k, ...rest] = t.split('=');
  if (k && rest.length) process.env[k.trim()] = rest.join('=').trim().replace(/^["']|["']$/g, '');
});

const email = process.argv[2];
const apply = process.argv.includes('--apply');
if (!email) {
  console.error('Usage: npx tsx scripts/unenroll_registry_mfa_totp.ts <email> [--apply]');
  process.exit(1);
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function main() {
  const { data: linkData, error: linkError } = await supabase.auth.admin.generateLink({
    type: 'magiclink',
    email,
    options: { redirectTo: `${getSiteUrl()}/registry/auth/callback` },
  });
  if (linkError) throw linkError;

  const verifyRes = await fetch(linkData.properties.action_link, { redirect: 'manual' });
  const location = verifyRes.headers.get('location');
  if (!location) throw new Error(`Expected a redirect from the verify link, got status ${verifyRes.status}`);
  const accessToken = new URLSearchParams(location.split('#')[1] ?? '').get('access_token');
  if (!accessToken) throw new Error(`No access_token in the verify redirect target: ${location}`);

  const userRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { apikey: anonKey, Authorization: `Bearer ${accessToken}` },
  });
  const userJson = await userRes.json();
  const totpFactors = (userJson?.factors ?? []).filter((f: { factor_type: string }) => f.factor_type === 'totp');

  if (totpFactors.length === 0) {
    console.log(`${email} has no TOTP factors.`);
    return;
  }

  console.log(`${email} has ${totpFactors.length} TOTP factor(s):`);
  for (const f of totpFactors) {
    console.log(`  id=${f.id} status=${f.status} created_at=${f.created_at}`);
  }

  if (!apply) {
    console.log('\nDry run — pass --apply to actually delete these.');
    return;
  }

  for (const f of totpFactors) {
    const delRes = await fetch(`${supabaseUrl}/auth/v1/factors/${f.id}`, {
      method: 'DELETE',
      headers: { apikey: anonKey, Authorization: `Bearer ${accessToken}` },
    });
    console.log(`Deleted ${f.id}: HTTP ${delRes.status}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
