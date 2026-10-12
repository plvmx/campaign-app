import { supabase } from '@/lib/supabaseClient';
import { isRecognizedAdminStatus } from '@/lib/campaignFilter';
import { isValidEmail } from '@/lib/validation';

export interface StateLeader {
  id: string;
  state: string;
  leader: string;
  mobile: string | null;
  admin: string | null;
  email: string | null;
  pending_email: string | null;
  email_confirmed_at: string | null;
  mfa_enrolled_at: string | null;
  created_at: string;
}

/**
 * The admin column is meant to hold exactly 'AD', 'SR', or null — never free
 * text. This is the app-level backstop for that (see also the DB-level CHECK
 * constraint in scripts/add_state_leaders_admin_check_constraint.sql).
 *
 * Without this, the admin panel's own free-text field could recreate the #78
 * bug: a recruiter's name typed into this column instead of a real role code,
 * which isRecognizedAdminStatus() treats as "not an admin" but which still
 * doesn't mean what the column is supposed to mean. Reuses
 * isRecognizedAdminStatus() rather than re-checking `=== 'AD' || === 'SR'`
 * inline, per the project's rule against duplicating that logic.
 */
function assertValidAdminValue(admin: string | null): void {
  if (admin !== null && !isRecognizedAdminStatus(admin)) {
    throw new Error(`"${admin}" is not a valid admin role — must be AD, SR, or left blank`);
  }
}

function assertValidEmailValue(email: string | null): void {
  if (email !== null && !isValidEmail(email)) {
    throw new Error(`"${email}" is not a valid email address`);
  }
}

/**
 * Best-effort audit write to state_leader_email_changes — never allowed to
 * fail the admin's actual save (create/update already succeeded by the time
 * this runs). See scripts/create_state_leader_email_changes_table.sql.
 */
async function recordEmailChange(
  stateLeaderId: string,
  oldEmail: string | null,
  newEmail: string | null,
  source: 'self-serve' | 'admin',
): Promise<void> {
  const { error } = await supabase
    .from('state_leader_email_changes')
    .insert([{ state_leader_id: stateLeaderId, old_email: oldEmail, new_email: newEmail, source }]);
  if (error) console.warn('Failed to record email change:', error);
}

export async function getStateLeaders(filterState?: string): Promise<StateLeader[]> {
  let query = supabase
    .from('state_leaders')
    .select('*')
    .order('state', { ascending: true })
    .order('leader', { ascending: true });
  if (filterState) query = query.eq('state', filterState);
  const { data, error } = await query;
  if (error) throw error;
  return (data || []) as StateLeader[];
}

export async function createStateLeader(input: {
  state: string;
  leader: string;
  mobile: string | null;
  admin: string | null;
  email: string | null;
}): Promise<void> {
  assertValidAdminValue(input.admin);
  assertValidEmailValue(input.email);

  const { error } = await supabase.from('state_leaders').insert([input]);
  if (error) {
    if (error.code === '23505') throw new Error('This state-leader combination already exists');
    throw error;
  }

  // The id needed for the audit row is only knowable after the insert, so it's
  // looked up separately (by the state+leader uniqueness key that error.code
  // 23505 above already relies on) rather than chaining .select().single() onto
  // the insert itself — that would make an unrelated read-back failure (e.g. a
  // transient RLS/replica hiccup) surface as a false "creation failed" error
  // even though the leader row was already committed. This whole lookup is
  // best-effort: it must never affect whether createStateLeader itself succeeds.
  if (input.email) {
    try {
      const { data, error: lookupError } = await supabase
        .from('state_leaders')
        .select('id')
        .eq('state', input.state)
        .eq('leader', input.leader)
        .single();
      if (lookupError || !data) throw lookupError ?? new Error('Newly created leader row not found');
      await recordEmailChange((data as { id: string }).id, null, input.email, 'admin');
    } catch (lookupErr) {
      console.warn('Failed to record email change for new leader:', lookupErr);
    }
  }
}

/** Same address, ignoring case and surrounding spaces; two empties are the same. */
function isSameEmail(a: string | null, b: string | null): boolean {
  return (a ?? '').trim().toLowerCase() === (b ?? '').trim().toLowerCase();
}

export async function updateStateLeader(
  id: string,
  input: { state: string; leader: string; mobile: string | null; admin: string | null; email: string | null },
): Promise<void> {
  assertValidAdminValue(input.admin);
  assertValidEmailValue(input.email);

  const { data: existing, error: fetchError } = await supabase.from('state_leaders').select('email').eq('id', id).single();
  if (fetchError) console.warn('Failed to fetch existing email before update:', fetchError);

  const previousEmail = (existing as { email: string | null } | null)?.email ?? null;
  // When an admin changes or removes a leader's email, everything that
  // vouched for the *old* address must go with it: the confirmation, the tie
  // to that address's sign-in account (user_id — otherwise the previous
  // address's owner could still sign in as this leader by email), and the 2FA
  // enrolment that belongs to that account. The leader then confirms again
  // (or the new address is bound when they finish 2FA setup). Skipped when the
  // pre-fetch failed — we can't tell whether the email really changed, and
  // wiping a working sign-in on a guess would be worse.
  const emailChanged = !fetchError && !isSameEmail(previousEmail, input.email);
  const payload = emailChanged
    ? { ...input, email_confirmed_at: null, user_id: null, mfa_enrolled_at: null }
    : input;

  const { error } = await supabase.from('state_leaders').update(payload).eq('id', id);
  if (error) throw error;

  // Skip the audit comparison entirely when the pre-fetch itself failed —
  // defaulting to "no previous email" in that case would risk logging a false
  // change (e.g. reporting old_email: null when it was never actually null).
  if (!fetchError && previousEmail !== input.email) {
    await recordEmailChange(id, previousEmail, input.email, 'admin');
  }
}

export async function deleteStateLeader(id: string): Promise<void> {
  const { error } = await supabase.from('state_leaders').delete().eq('id', id);
  if (error) throw error;
}
