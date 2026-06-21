import { supabase } from '@/lib/supabaseClient';

export interface ResultRow {
  id: string;
  first_name: string;
  category_code: string;
  created_at?: string;
}

export interface NewResultRow {
  campaign_id: string;
  first_name: string;
  category_code: string;
  user_id: string;
}

export async function getResultsByCampaignId(campaignId: string): Promise<ResultRow[]> {
  const { data, error } = await supabase
    .from('results')
    .select('id, first_name, category_code, created_at')
    .eq('campaign_id', campaignId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data || []) as ResultRow[];
}

/**
 * Insert new result rows in one round-trip. Returns the inserted rows
 * (including their server-generated `id`s) in the same order they were
 * supplied, so the caller can map ids back onto its in-memory slots.
 */
export async function insertResults(
  rows: NewResultRow[],
): Promise<Array<{ id: string; first_name: string; category_code: string }>> {
  if (rows.length === 0) return [];
  const { data, error } = await supabase
    .from('results')
    .insert(rows)
    .select('id, first_name, category_code');
  if (error) throw error;
  return data || [];
}

/**
 * Update an existing result row's name and/or category by primary key.
 * Use this when the user edits an already-saved name in place.
 */
export async function updateResult(
  id: string,
  fields: { first_name: string; category_code: string },
): Promise<void> {
  const { error } = await supabase
    .from('results')
    .update(fields)
    .eq('id', id);
  if (error) throw error;
}

/**
 * Delete a result row by primary key. Idempotent — deleting a row that
 * is already gone is a no-op as far as the caller is concerned.
 */
export async function deleteResult(id: string): Promise<void> {
  const { error } = await supabase
    .from('results')
    .delete()
    .eq('id', id);
  if (error) throw error;
}
