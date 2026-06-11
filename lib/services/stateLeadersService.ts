import { supabase } from '@/lib/supabaseClient';

export interface StateLeader {
  id: string;
  state: string;
  leader: string;
  mobile: string | null;
  admin: string | null;
  created_at: string;
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
  const { error } = await supabase.from('state_leaders').update(input).eq('id', id);
  if (error) throw error;
}

export async function deleteStateLeader(id: string): Promise<void> {
  const { error } = await supabase.from('state_leaders').delete().eq('id', id);
  if (error) throw error;
}
