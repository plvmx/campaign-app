import { supabase } from '@/lib/supabaseClient';
import { isRecognizedAdminStatus } from '@/lib/campaignFilter';

export interface StateLeader {
  id: string;
  state: string;
  leader: string;
  mobile: string | null;
  admin: string | null;
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
}): Promise<void> {
  assertValidAdminValue(input.admin);

  const { error } = await supabase.from('state_leaders').insert([input]);
  if (error) {
    if (error.code === '23505') throw new Error('This state-leader combination already exists');
    throw error;
  }
}

export async function updateStateLeader(
  id: string,
  input: { state: string; leader: string; mobile: string | null; admin: string | null },
): Promise<void> {
  assertValidAdminValue(input.admin);

  const { error } = await supabase.from('state_leaders').update(input).eq('id', id);
  if (error) throw error;
}

export async function deleteStateLeader(id: string): Promise<void> {
  const { error } = await supabase.from('state_leaders').delete().eq('id', id);
  if (error) throw error;
}
