/**
 * One-off, run when mandatory admin 2FA goes live (2026-10-12) — ends every
 * app session that still carries an AD/SR identity from the old mobile+name
 * login, because switching enforcement on does not by itself sign anyone out.
 *
 * What it finds: user_profiles rows whose name+state match an AD or SR
 * state_leaders row AND whose auth account is *anonymous* (every mobile+name
 * session is). Real-auth (email + 2FA) accounts are never touched.
 * What it does with each (--apply): deletes its user_profiles/user_roles rows
 * (RLS is_admin() and the app both read user_profiles, so admin access ends
 * at once) and bans the anonymous account so its refresh token stops working.
 * It does NOT delete the auth account — audit rows elsewhere reference those
 * ids. Reversible: a ban can be lifted, and an admin simply signs in again
 * via email + 2FA.
 *
 * SAFETY: dry run by default (prints counts, writes only a backup of what it
 * would touch to backups/, which is gitignored). Idempotent — a re-run after
 * --apply finds nothing left.
 *
 * Usage:
 *   npx tsx scripts/revoke_admin_app_sessions.ts           # dry run
 *   npx tsx scripts/revoke_admin_app_sessions.ts --apply   # actually revoke
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

const apply = process.argv.includes('--apply');
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

const key = (name: string | null, state: string | null) => `${(name ?? '').trim().toLowerCase()}|${(state ?? '').trim().toUpperCase()}`;

async function fetchAll<T>(table: string, columns: string): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from(table).select(columns).range(from, from + 999);
    if (error) throw error;
    out.push(...(data as T[]));
    if (!data || data.length < 1000) break;
  }
  return out;
}

async function inBatches<T>(items: T[], size: number, fn: (item: T) => Promise<void>) {
  for (let i = 0; i < items.length; i += size) await Promise.all(items.slice(i, i + size).map(fn));
}

async function main() {
  const leaders = await fetchAll<{ leader: string; state: string; admin: string | null }>('state_leaders', 'leader, state, admin');
  const adminKeys = new Set(leaders.filter((l) => l.admin === 'AD' || l.admin === 'SR').map((l) => key(l.leader, l.state)));

  const profiles = await fetchAll<{ user_id: string; name: string | null; state: string | null }>('user_profiles', 'user_id, name, state');
  const adminProfiles = profiles.filter((p) => adminKeys.has(key(p.name, p.state)));
  console.log(`user_profiles: ${profiles.length} total, ${adminProfiles.length} carry an AD/SR identity`);

  const targets: typeof adminProfiles = [];
  let realAuth = 0;
  let missing = 0;
  await inBatches(adminProfiles, 10, async (p) => {
    const { data, error } = await supabase.auth.admin.getUserById(p.user_id);
    if (error || !data?.user) { missing++; return; }
    if (data.user.is_anonymous) targets.push(p); else realAuth++;
  });
  console.log(`  anonymous (old mobile+name sessions) to revoke: ${targets.length}`);
  console.log(`  real-auth (email + 2FA) accounts left alone:   ${realAuth}`);
  if (missing) console.log(`  profiles whose auth account no longer exists:  ${missing}`);

  const outDir = path.join(__dirname, '..', 'backups');
  fs.mkdirSync(outDir, { recursive: true });
  const backupFile = path.join(outDir, `revoked_admin_app_sessions_${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(backupFile, JSON.stringify(targets, null, 2));
  console.log(`Backup of the profiles affected: ${backupFile}`);

  if (!apply) {
    console.log('\nDry run — nothing changed. Re-run with --apply to revoke these sessions.');
    return;
  }

  let done = 0;
  const failures: string[] = [];
  await inBatches(targets, 8, async (p) => {
    const steps = [
      supabase.from('user_profiles').delete().eq('user_id', p.user_id),
      supabase.from('user_roles').delete().eq('user_id', p.user_id),
    ];
    const results = await Promise.all(steps);
    const failed = results.find((r) => r.error);
    if (failed?.error) { failures.push(`${p.user_id}: ${failed.error.message}`); return; }
    const { error: banError } = await supabase.auth.admin.updateUserById(p.user_id, { ban_duration: '876000h' });
    if (banError) { failures.push(`${p.user_id}: ban failed: ${banError.message}`); return; }
    done++;
  });
  console.log(`\nRevoked ${done} of ${targets.length} sessions.`);
  if (failures.length) console.log(`Failures (${failures.length}):\n${failures.slice(0, 20).join('\n')}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
