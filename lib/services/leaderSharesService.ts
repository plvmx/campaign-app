import { supabase } from '@/lib/supabaseClient';

export interface LeaderShare {
  id: string;
  owner_state: string;
  owner_leader: string;
  shared_with_state: string;
  shared_with_leader: string;
  created_at: string;
}

export interface NewLeaderShare {
  owner_state: string;
  owner_leader: string;
  shared_with_state: string;
  shared_with_leader: string;
}

/** Fetch every leader-sharing row, ordered by owner state then leader. */
export async function getLeaderShares(): Promise<LeaderShare[]> {
  const { data, error } = await supabase
    .from('leader_shares')
    .select('*')
    .order('owner_state', { ascending: true })
    .order('owner_leader', { ascending: true });
  if (error) throw error;
  return (data || []) as LeaderShare[];
}

/** Create a leader-sharing row. Throws a friendly error on the (owner, shared-with) duplicate conflict. */
export async function createLeaderShare(input: NewLeaderShare): Promise<void> {
  const { error } = await supabase.from('leader_shares').insert([input]);
  if (error) {
    if (error.code === '23505') throw new Error('This sharing relationship already exists');
    throw error;
  }
}

export async function deleteLeaderShare(id: string): Promise<void> {
  const { error } = await supabase.from('leader_shares').delete().eq('id', id);
  if (error) throw error;
}
