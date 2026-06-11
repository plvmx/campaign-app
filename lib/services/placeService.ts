import { supabase } from '@/lib/supabaseClient';

/** Insert a new place for the given state. Silently ignores duplicate (23505). */
export async function addNewPlaceForState(state: string, place: string): Promise<void> {
  const { error } = await supabase
    .from('state_places')
    .insert([{ state: state.toUpperCase().trim(), place: place.trim() }]);
  if (error && error.code !== '23505')
    throw new Error(`Failed to add new place: ${error.message}`);
}
