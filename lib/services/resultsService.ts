import { supabase } from '@/lib/supabaseClient';

export interface ResultRow {
  first_name: string;
  category_code: string;
  created_at?: string;
}

export interface ResultUpsert {
  campaign_id: string;
  first_name: string;
  category_code: string;
  user_id: string;
}

export async function getResultsByCampaignId(campaignId: string): Promise<ResultRow[]> {
  const { data, error } = await supabase
    .from('results')
    .select('first_name, category_code, created_at')
    .eq('campaign_id', campaignId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data || []) as ResultRow[];
}

export async function upsertResults(rows: ResultUpsert[]): Promise<void> {
  if (rows.length === 0) return;
  const { error } = await supabase
    .from('results')
    .upsert(rows, { onConflict: 'campaign_id,first_name,category_code' });
  if (error) throw error;
}

export async function deleteResult(
  campaignId: string,
  firstName: string,
  categoryCode: string,
): Promise<void> {
  const { error } = await supabase
    .from('results')
    .delete()
    .eq('campaign_id', campaignId)
    .eq('first_name', firstName)
    .eq('category_code', categoryCode);
  if (error) throw error;
}
