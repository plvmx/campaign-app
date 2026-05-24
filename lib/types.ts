/**
 * Shared type definitions for the campaign app
 */

// ---------------------------------------------------------------------------
// Campaign
// ---------------------------------------------------------------------------

export interface Campaign {
  id: string;
  date: string;
  state: string;
  place: string;
  time: string;
  leader: string;
  mobile: string | null;
  /** Campaign category code — references campaign_categories.code. Default 'TWOL'. */
  category: string | null;
  tl_ok: boolean;
  sr_ok: boolean;
  created_at: string;
  source?: string | null;
  user_id?: string;
  /** Results counts — populated when recording results */
  team_size?: number | null;
  pp_cnt?: number | null;
  fp_cnt?: number | null;
  fpsp_cnt?: number | null;
  ir_cnt?: number | null;
}

// ---------------------------------------------------------------------------
// Campaign rules
// ---------------------------------------------------------------------------

/** Typed shape for the JSONB rule_config column. */
export interface RuleConfig {
  reference_date?: string;
  exceptions?: string[];
  override_fields?: Record<string, Record<string, unknown>>;
  [key: string]: unknown;
}

export interface CampaignRule {
  id: string;
  name: string;
  leader: string;
  state: string;
  place: string;
  time: string;
  mobile: string | null;
  /**
   * 'custom' is deprecated — existing DB rows only; no longer creatable via the UI.
   * Legacy custom rules generate no campaigns until migrated to a supported type.
   */
  frequency_type: 'weekly' | 'biweekly' | 'monthly' | 'custom';
  frequency_value: number | null;
  month_week_number: number | null;
  month_day_of_week: number | null;
  day_of_week: number | null;
  start_date: string | null;
  end_date: string | null;
  is_active: boolean;
  priority: number;
  rule_config: RuleConfig;
  notes: string | null;
}

// ---------------------------------------------------------------------------
// User
// ---------------------------------------------------------------------------

export interface UserProfile {
  id: string;
  user_id: string;
  name: string | null;
  state: string | null;
  regular_place: string | null;
  regular_time: string | null;
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Leader shares
// ---------------------------------------------------------------------------

export interface LeaderShareOwner {
  owner_state: string;
  owner_leader: string;
}
