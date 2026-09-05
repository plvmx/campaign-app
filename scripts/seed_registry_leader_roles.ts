/**
 * Registry portal — one-off script to grant registry.leader_roles access.
 * See docs/registry-pipeline/BRIEF.md ("Supabase Auth (magic-link) rollout
 * for leaders") and app/registry/* for the sign-in flow this feeds.
 *
 * registry.leader_roles.user_id references auth.users(id), and the portal's
 * sign-in form uses shouldCreateUser: false (invite-only — see
 * app/registry/login/page.tsx), so a person needs an auth.users row before
 * they can ever request a magic link at all. This script creates that row
 * if it doesn't already exist, then grants the role in registry.leader_roles.
 *
 * Uses admin.generateLink({type: 'invite'}) rather than
 * admin.inviteUserByEmail() — both create the auth.users row the same way,
 * but inviteUserByEmail also tries to *send* the invite email itself via
 * Supabase's built-in mailer, which isn't configured for production
 * sending on a fresh project (no custom SMTP) and failed outright the
 * first time this ran ("AuthApiError: Error sending invite email", 500).
 * generateLink sidesteps that entirely: it hands back a ready-to-use link
 * without attempting delivery, so this script — and its success — doesn't
 * depend on Supabase's mailer at all. YOU are responsible for getting the
 * printed link to each person (email it yourself, Slack it, etc).
 *
 * Idempotent — safe to re-run (e.g. to add someone new to the SEED list
 * below): skips creating anyone who already has an auth.users row (though
 * see the note in ensureUser() about re-inviting such a person), and
 * upserts the leader_roles row either way. Each person in SEED is
 * processed independently — one failure doesn't stop the rest.
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

async function findExistingUser(email: string): Promise<{ id: string; hasSignedIn: boolean } | null> {
  // supabase-js's admin.listUsers() has no reliable email filter across all
  // versions, so paginate through everyone — fine for an account this size.
  const perPage = 200;
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    const match = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (match) return { id: match.id, hasSignedIn: match.last_sign_in_at != null };
    if (data.users.length < perPage) return null; // last page
  }
  throw new Error(`findExistingUser: gave up after 20 pages looking for ${email} — account is larger than expected, extend the page cap`);
}

function requireLiveSiteUrl(): string {
  const siteUrl = getSiteUrl();
  if (siteUrl.includes('localhost')) {
    // getSiteUrl() falls back to localhost when NEXT_PUBLIC_SITE_URL isn't
    // set — fine for OG metadata, not fine for a link someone else will
    // actually click. This script runs on a dev machine, not on Vercel, so
    // VERCEL_PROJECT_PRODUCTION_URL won't be set either; it needs
    // NEXT_PUBLIC_SITE_URL=https://campaign.afj.org.au in .env.local.
    throw new Error('Resolved site URL is localhost — set NEXT_PUBLIC_SITE_URL in .env.local before inviting real people.');
  }
  return siteUrl;
}

async function generateInviteLink(email: string): Promise<{ id: string; actionLink: string }> {
  // Must land on /registry/auth/callback, not /registry/login — that's the
  // page that actually knows how to exchange the invite link's code for a
  // session (see its own header comment). /registry/login is just the
  // request-a-magic-link form; it doesn't look at the URL at all.
  const redirectTo = `${requireLiveSiteUrl()}/registry/auth/callback`;
  const { data, error } = await supabase.auth.admin.generateLink({ type: 'invite', email, options: { redirectTo } });
  if (error) throw error;
  return { id: data.user.id, actionLink: data.properties.action_link };
}

type EnsureResult = { id: string; actionLink: string | null; note: string };

async function ensureUser(email: string): Promise<EnsureResult> {
  const existing = await findExistingUser(email);

  if (existing?.hasSignedIn) {
    // Already has a working account — nothing to send, don't regenerate a link.
    return { id: existing.id, actionLink: null, note: 'already exists and has signed in before' };
  }

  if (!apply) {
    return existing
      ? { id: existing.id, actionLink: null, note: 'dry run — exists but never signed in; would regenerate an invite link' }
      : { id: '(dry-run)', actionLink: null, note: 'dry run — would create and generate an invite link' };
  }

  // Either brand new, or the auth.users row exists but they've never
  // completed sign-in (e.g. a previous invite email never arrived) —
  // generateLink() creates the row if needed and always hands back a
  // fresh, valid link either way, so this one call covers both cases.
  const { id, actionLink } = await generateInviteLink(email);
  return {
    id,
    actionLink,
    note: existing ? 'existing but unconfirmed — regenerated a fresh invite link' : 'created — invite link generated',
  };
}

async function main() {
  console.log(apply ? 'Applying...' : 'Dry run (pass --apply to write).');
  let hadFailure = false;

  for (const { email, role } of SEED) {
    try {
      const { id, actionLink, note } = await ensureUser(email);
      console.log(`${email}: auth.users id=${id} (${note})`);
      if (actionLink) {
        console.log(`  Send this link to ${email} yourself (it is not emailed automatically):`);
        console.log(`  ${actionLink}`);
      }

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
    } catch (err) {
      hadFailure = true;
      console.error(`${email}: FAILED —`, err);
      // Keep going — one person's failure shouldn't block everyone else in SEED.
    }
  }

  console.log(hadFailure ? 'Done, with failures — see above.' : 'Done.');
  if (hadFailure) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
