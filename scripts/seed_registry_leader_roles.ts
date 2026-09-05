/**
 * Registry portal — one-off script to grant registry.leader_roles access.
 * See docs/registry-pipeline/BRIEF.md ("Supabase Auth (magic-link) rollout
 * for leaders") and app/registry/* for the sign-in flow this feeds.
 *
 * registry.leader_roles.user_id references auth.users(id), and the portal's
 * sign-in form uses shouldCreateUser: false (invite-only — see
 * app/registry/login/page.tsx), so a person needs an auth.users row before
 * they can ever request a magic link at all. This script creates that row
 * (via the Admin API, same as Supabase Dashboard's "Invite user") if it
 * doesn't already exist, then grants the role in registry.leader_roles.
 *
 * Idempotent — safe to re-run (e.g. to add someone new to the SEED list
 * below): skips inviting anyone who already has an auth.users row, and
 * upserts the leader_roles row either way.
 *
 * Edit the SEED list below before running.
 *
 * Usage:
 *   npx tsx scripts/seed_registry_leader_roles.ts          # dry-run summary
 *   npx tsx scripts/seed_registry_leader_roles.ts --apply  # actually write
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

type SeedRole = 'national_admin' | 'whatsapp_admin';

// --- Edit this list, then run with --apply. ---
const SEED: { email: string; role: SeedRole }[] = [
  { email: 'plvmx01@gmail.com', role: 'national_admin' },
  { email: 'tony@afj.org.au', role: 'national_admin' },
  { email: 'lorraine@afj.org.au', role: 'national_admin' },
];
// -----------------------------------------------

const apply = process.argv.includes('--apply');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

async function findExistingUserId(email: string): Promise<string | null> {
  // supabase-js's admin.listUsers() has no reliable email filter across all
  // versions, so paginate through everyone — fine for an account this size.
  const perPage = 200;
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    const match = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (match) return match.id;
    if (data.users.length < perPage) return null; // last page
  }
  throw new Error(`findExistingUserId: gave up after 20 pages looking for ${email} — account is larger than expected, extend the page cap`);
}

async function ensureUser(email: string): Promise<{ id: string; created: boolean }> {
  const existingId = await findExistingUserId(email);
  if (existingId) return { id: existingId, created: false };

  if (!apply) return { id: '(dry-run — would create)', created: true };

  const siteUrl = getSiteUrl();
  if (siteUrl.includes('localhost')) {
    // getSiteUrl() falls back to localhost when NEXT_PUBLIC_SITE_URL isn't
    // set — fine for OG metadata, not fine for an email someone else will
    // actually click. This script runs on a dev machine, not on Vercel, so
    // VERCEL_PROJECT_PRODUCTION_URL won't be set either; it needs
    // NEXT_PUBLIC_SITE_URL=https://campaign.afj.org.au in .env.local.
    throw new Error('Resolved site URL is localhost — set NEXT_PUBLIC_SITE_URL in .env.local before inviting real people.');
  }
  const { data, error } = await supabase.auth.admin.inviteUserByEmail(email, { redirectTo: `${siteUrl}/registry/login` });
  if (error) throw error;
  return { id: data.user.id, created: true };
}

async function main() {
  console.log(apply ? 'Applying...' : 'Dry run (pass --apply to write).');

  for (const { email, role } of SEED) {
    const { id, created } = await ensureUser(email);
    console.log(`${email}: auth.users id=${id} (${created ? 'invited just now' : 'already existed'})`);

    if (!apply) {
      console.log(`  would upsert registry.leader_roles: { user_id: ${id}, role: '${role}' }`);
      continue;
    }

    const { error } = await supabase
      .schema('registry')
      .from('leader_roles')
      .upsert({ user_id: id, role, state: null }, { onConflict: 'user_id' });
    if (error) throw error;
    console.log(`  registry.leader_roles row set: role=${role}`);
  }

  console.log('Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
