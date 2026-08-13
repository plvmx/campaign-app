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
 * Insert new result rows, one round-trip per row, run concurrently. Returns
 * the inserted rows (including their server-generated `id`s) in the same
 * order they were supplied, so the caller can map ids back onto its
 * in-memory slots.
 *
 * Deliberately not a single multi-row `INSERT ... RETURNING`: PostgREST/
 * Postgres don't contractually guarantee a multi-row RETURNING preserves
 * insert order, and the caller (record-results) maps ids back onto its rows
 * purely by array position. There's no way to cross-check that mapping by
 * content instead, because duplicate `first_name`+`category_code` pairs are
 * explicitly allowed (see #68). One row per request makes each result
 * unambiguous by construction — `Promise.all` preserves the correspondence
 * between `rows[i]` and the returned array's `i`th entry regardless of which
 * request resolves first.
 */
export async function insertResults(
  rows: NewResultRow[],
): Promise<Array<{ id: string; first_name: string; category_code: string }>> {
  if (rows.length === 0) return [];
  return Promise.all(
    rows.map(async (row) => {
      const { data, error } = await supabase
        .from('results')
        .insert([row])
        .select('id, first_name, category_code')
        .single();
      if (error) throw error;
      if (!data) throw new Error('Insert succeeded but no row was returned');
      return data;
    }),
  );
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
