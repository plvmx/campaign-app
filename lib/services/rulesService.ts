import { supabase } from '@/lib/supabaseClient';
import type { CampaignRule } from '@/lib/campaignRules';

interface GetRulesOptions {
  adminStatus: string | null;
  userState: string | null;
  userLeader: string | null;
}

export async function getRules({
  adminStatus,
  userState,
  userLeader,
}: GetRulesOptions): Promise<CampaignRule[]> {
  const isTeamLeader = adminStatus !== 'AD' && adminStatus !== 'SR' && !!userState;
  const isStateReporter = adminStatus === 'SR';

  if (isTeamLeader && !userLeader) return [];

  let query = supabase.from('campaign_rules').select('*');

  if (isStateReporter && userState) {
    query = query.eq('state', userState.toUpperCase().trim());
  }
  if (isTeamLeader && userState && userLeader) {
    query = query.eq('state', userState.toUpperCase().trim()).eq('leader', userLeader);
  }

  const { data, error } = await query
    .order('priority', { ascending: false })
    .order('created_at', { ascending: false });

  if (error) throw error;
  return (data || []) as CampaignRule[];
}

export async function createRule(
  ruleData: Omit<CampaignRule, 'id'>,
  createdBy: string,
): Promise<void> {
  const { error } = await supabase
    .from('campaign_rules')
    .insert([{ ...ruleData, created_by: createdBy }]);
  if (error) throw error;
}

export async function updateRule(
  id: string,
  ruleData: Partial<Omit<CampaignRule, 'id'>>,
): Promise<void> {
  const { error } = await supabase.from('campaign_rules').update(ruleData).eq('id', id);
  if (error) throw error;
}

export async function deleteRule(id: string): Promise<void> {
  const { error } = await supabase.from('campaign_rules').delete().eq('id', id);
  if (error) throw error;
}

export async function setRuleActive(id: string, isActive: boolean): Promise<void> {
  const { error } = await supabase
    .from('campaign_rules')
    .update({ is_active: isActive })
    .eq('id', id);
  if (error) throw error;
}
