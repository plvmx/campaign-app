/**
 * One-off diagnostic — checks for a mismatch between auth.users and
 * registry.leader_roles for a given email. Not part of the app.
 *
 * Usage:
 *   npx tsx scripts/debug_check_leader_role.ts <email>
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

const email = process.argv[2];
if (!email) {
  console.error('Usage: npx tsx scripts/debug_check_leader_role.ts <email>');
  process.exit(1);
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

async function main() {
  console.log(`Looking for every auth.users row matching ${email}...`);
  const matches = [];
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    matches.push(...data.users.filter((u) => u.email?.toLowerCase() === email.toLowerCase()));
    if (data.users.length < 200) break;
  }
  console.log(`Found ${matches.length} auth.users row(s):`);
  for (const u of matches) {
    console.log(`  id=${u.id} created_at=${u.created_at} last_sign_in_at=${u.last_sign_in_at ?? 'never'}`);
  }

  console.log('\nAll rows in registry.leader_roles:');
  const { data: roles, error: rolesError } = await supabase.schema('registry').from('leader_roles').select('*');
  if (rolesError) throw rolesError;
  for (const r of roles ?? []) {
    console.log(`  user_id=${r.user_id} role=${r.role} state=${r.state} mfa_required=${r.mfa_required}`);
  }

  console.log('\nDo any of this email\'s user ids have a leader_roles row?');
  for (const u of matches) {
    const hasRole = (roles ?? []).some((r) => r.user_id === u.id);
    console.log(`  ${u.id}: ${hasRole ? 'YES' : 'no'}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
