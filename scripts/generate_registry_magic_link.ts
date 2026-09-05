/**
 * Registry portal — generate a one-off sign-in link for an EXISTING
 * account, bypassing Supabase's own email sending entirely.
 *
 * Useful whenever /registry/login's normal magic-link flow (which calls
 * supabase.auth.signInWithOtp(), and so depends on SMTP actually working —
 * see docs/registry-pipeline/OPERATIONS.md's SMTP incident) can't be
 * relied on yet, but someone with an existing registry.leader_roles /
 * auth.users account needs to sign in anyway. Unlike
 * scripts/seed_registry_leader_roles.ts (which is for granting access to
 * someone new), this is purely a sign-in shortcut — it doesn't touch
 * registry.leader_roles at all.
 *
 * Usage:
 *   npx tsx scripts/generate_registry_magic_link.ts <email>
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
  console.error('Usage: npx tsx scripts/generate_registry_magic_link.ts <email>');
  process.exit(1);
}

const siteUrl = getSiteUrl();
if (siteUrl.includes('localhost')) {
  console.error('Resolved site URL is localhost — set NEXT_PUBLIC_SITE_URL=https://campaign.afj.org.au in .env.local first.');
  process.exit(1);
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

async function main() {
  // type: 'magiclink' requires the account to already exist (errors
  // otherwise) — unlike 'invite', which creates one. That's deliberate
  // here: this script is a sign-in shortcut for an existing account, not
  // another way to grant access.
  const { data, error } = await supabase.auth.admin.generateLink({
    type: 'magiclink',
    email,
    options: { redirectTo: `${siteUrl}/registry/auth/callback` },
  });
  if (error) throw error;

  console.log(`Sign-in link for ${email} (single use, do not share beyond that person):`);
  console.log(data.properties.action_link);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
