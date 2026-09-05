/**
 * One-off diagnostic — NOT part of the app, not meant to be kept long-term.
 *
 * Reproduces the entire /registry MFA enrollment call server-side, with no
 * browser involved, so we can see exactly what Supabase's totp.qr_code
 * field actually contains. Two guesses at how to embed it as an <img> src
 * (raw concatenation, then encodeURIComponent) have both rendered a blank
 * image live, on a completely fresh account with no enrollment history —
 * so the assumption that it's raw, un-prefixed SVG markup (per
 * supabase-js's own TS doc comment) may simply be wrong for what this
 * project's GoTrue version actually returns.
 *
 * How: generates a real magic-link for the given (already-existing, no
 * prior TOTP factor) email, follows the verify redirect manually to pull
 * the access_token straight out of the Location header (never touches a
 * browser), then POSTs directly to /auth/v1/factors with that token —
 * the exact same request app/registry/mfa/enroll/page.tsx makes via
 * supabase.auth.mfa.enroll({factorType: 'totp'}).
 *
 * Usage:
 *   npx tsx scripts/debug_totp_enroll_response.ts <email>
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
if (!email) {
  console.error('Usage: npx tsx scripts/debug_totp_enroll_response.ts <email>');
  process.exit(1);
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function main() {
  const siteUrl = getSiteUrl();
  const { data: linkData, error: linkError } = await supabase.auth.admin.generateLink({
    type: 'magiclink',
    email,
    options: { redirectTo: `${siteUrl}/registry/auth/callback` },
  });
  if (linkError) throw linkError;

  const verifyRes = await fetch(linkData.properties.action_link, { redirect: 'manual' });
  const location = verifyRes.headers.get('location');
  if (!location) throw new Error(`Expected a redirect from the verify link, got status ${verifyRes.status}`);

  const hash = location.split('#')[1] ?? '';
  const accessToken = new URLSearchParams(hash).get('access_token');
  if (!accessToken) throw new Error(`No access_token in the verify redirect target: ${location}`);

  // Clean up any stale unverified factor from an earlier attempt first —
  // Supabase rejects a second enroll() with the same (default, empty)
  // friendly_name as a 422 conflict, which is exactly what happened live
  // on the second/third attempt. Without this, this script would hit the
  // same conflict instead of getting a fresh qr_code to inspect.
  const userRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { apikey: anonKey, Authorization: `Bearer ${accessToken}` },
  });
  const userJson = await userRes.json();
  const staleFactors = (userJson?.factors ?? []).filter((f: { factor_type: string; status: string }) => f.factor_type === 'totp' && f.status !== 'verified');
  for (const f of staleFactors) {
    console.log(`Deleting stale unverified factor ${f.id}...`);
    await fetch(`${supabaseUrl}/auth/v1/factors/${f.id}`, {
      method: 'DELETE',
      headers: { apikey: anonKey, Authorization: `Bearer ${accessToken}` },
    });
  }

  const enrollRes = await fetch(`${supabaseUrl}/auth/v1/factors`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: anonKey,
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ factor_type: 'totp' }),
  });
  const enrollJson = await enrollRes.json();

  console.log('Enroll HTTP status:', enrollRes.status);
  console.log('Full response:', JSON.stringify(enrollJson, null, 2));

  const qr = enrollJson?.totp?.qr_code;
  console.log('---');
  console.log('typeof qr_code:', typeof qr);
  console.log('qr_code length:', qr?.length);
  console.log('qr_code first 150 chars:', JSON.stringify(qr?.slice(0, 150)));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
