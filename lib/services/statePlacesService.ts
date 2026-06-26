import { supabase } from '@/lib/supabaseClient';

export interface StatePlace {
  id: string;
  state: string;
  place: string;
  created_at: string;
  latitude?: number | null;
  longitude?: number | null;
}

export async function getStatePlaces(filterState?: string): Promise<StatePlace[]> {
  let query = supabase
    .from('state_places')
    .select('*')
    .order('state', { ascending: true })
    .order('place', { ascending: true });
  if (filterState) query = query.eq('state', filterState);
  const { data, error } = await query;
  if (error) throw error;
  return (data || []) as StatePlace[];
}

export async function createStatePlace(input: { state: string; place: string }): Promise<void> {
  const { error } = await supabase.from('state_places').insert([input]);
  if (error) {
    if (error.code === '23505') throw new Error('This state-place combination already exists');
    throw error;
  }
}

export async function updateStatePlace(
  id: string,
  input: { state: string; place: string },
): Promise<void> {
  const { error } = await supabase.from('state_places').update(input).eq('id', id);
  if (error) throw error;
}

export async function deleteStatePlace(id: string): Promise<void> {
  const { error } = await supabase.from('state_places').delete().eq('id', id);
  if (error) throw error;
}

/** Persist geocoded coordinates for a place once resolved, so future lookups skip geocoding. */
export async function setStatePlaceCoordinates(
  id: string,
  coords: { latitude: number; longitude: number },
): Promise<void> {
  const { error } = await supabase.from('state_places').update(coords).eq('id', id);
  if (error) throw error;
}
