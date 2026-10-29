/**
 * Campaign Report project — see docs/campaign-report/BRIEF.md.
 *
 * Backs the Campaign Reports management screen (/admin/campaign-reports):
 * loads every report in a compact shape, applies one hand edit to a report's
 * derived state / location / leader (audited to campaign_report_edits), and
 * pages that audit log. Server-side only — injected client, always
 * `supabaseAdmin` (campaign_reports has no authenticated write policy).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { AUSTRALIAN_STATES } from '@/lib/constants';
import { ensureStateLocation, getStateLocations } from '@/lib/services/stateLocations';
import {
  REPORT_FIELD_COLUMNS,
  type EditableReportField,
  type ManageDataResponse,
  type ManageReport,
  type ReportEditLogResponse,
  type ReportEditResponse,
} from '@/lib/campaignReportManageTypes';

const PAGE = 1000;
export const EDIT_LOG_PAGE_SIZE = 50;

interface ReportRow {
  id: string;
  submitted_at: string;
  campaign_date: string | null;
  campaign_date_raw: string | null;
  location_raw: string | null;
  leader_raw: string | null;
  derived_state: string | null;
  derived_location: string | null;
  derived_leader: string | null;
  partial_presentations: number | null;
  full_presentations: number | null;
  sinners_prayer: number | null;
  information_requests: number | null;
  needs_review: boolean;
}

const REPORT_COLUMNS =
  'id, submitted_at, campaign_date, campaign_date_raw, location_raw, leader_raw, derived_state, derived_location, derived_leader, partial_presentations, full_presentations, sinners_prayer, information_requests, needs_review';

export function toManageReport(r: ReportRow): ManageReport {
  return {
    id: r.id,
    submittedAt: r.submitted_at,
    campaignDate: r.campaign_date,
    campaignDateRaw: r.campaign_date_raw,
    locationTyped: r.location_raw,
    leader: r.leader_raw,
    state: r.derived_state,
    location: r.derived_location,
    matchedLeader: r.derived_leader,
    partial: r.partial_presentations,
    full: r.full_presentations,
    sinnersPrayer: r.sinners_prayer,
    infoRequests: r.information_requests,
    needsReview: r.needs_review,
  };
}

export async function getManageData(client: SupabaseClient): Promise<ManageDataResponse> {
  const rows: ReportRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await client
      .from('campaign_reports').select(REPORT_COLUMNS).order('submitted_at', { ascending: false }).range(from, from + PAGE - 1);
    if (error) throw error;
    rows.push(...((data ?? []) as ReportRow[]));
    if ((data?.length ?? 0) < PAGE) break;
  }
  const locations = await getStateLocations(client);
  const { data: leaders, error: lErr } = await client.from('state_leaders').select('state, leader').order('state').order('leader');
  if (lErr) throw lErr;
  return { reports: rows.map(toManageReport), locations, leaders: leaders ?? [] };
}

export type ApplyEditResult =
  | { ok: true; report: ReportEditResponse }
  | { ok: false; status: number; error: string; code?: 'unknown_location' };

export interface ApplyEditInput {
  id: string;
  field: EditableReportField;
  value: string | null;
  /** Confirms a location not yet in State Places should be added to it. */
  addLocation?: boolean;
  actor: { userId: string; label: string };
}

/**
 * Applies one edit. Changing the state also clears a location or leader that
 * doesn't exist in the new state (each clear is audited too), so a report
 * can never carry e.g. a VIC location under NSW.
 */
export async function applyReportEdit(client: SupabaseClient, input: ApplyEditInput): Promise<ApplyEditResult> {
  const value = input.value?.trim() || null;

  const { data: existing, error: fetchError } = await client
    .from('campaign_reports').select('id, derived_state, derived_location, derived_leader').eq('id', input.id).maybeSingle();
  if (fetchError) throw fetchError;
  if (!existing) return { ok: false, status: 404, error: 'Report not found' };

  const next = { state: existing.derived_state as string | null, location: existing.derived_location as string | null, leader: existing.derived_leader as string | null };
  const before = { ...next };

  if (input.field === 'state') {
    if (value !== null && !AUSTRALIAN_STATES.includes(value as never)) return { ok: false, status: 400, error: `Invalid state: ${value}` };
    next.state = value;
  } else if (!next.state) {
    return { ok: false, status: 400, error: 'Choose a state first' };
  } else if (input.field === 'location') {
    next.location = value;
  } else {
    next.leader = value;
  }

  const leaderInState = async (state: string, name: string) => {
    const { data, error } = await client.from('state_leaders').select('leader').eq('state', state).eq('leader', name).limit(1);
    if (error) throw error;
    return (data?.length ?? 0) > 0;
  };

  if (input.field === 'location' && value && next.state) {
    const found = await ensureStateLocation(client, next.state, value, Boolean(input.addLocation));
    if (!found.ok) return { ok: false, status: 409, code: found.code, error: found.error };
    next.location = found.location; // the stored spelling
  }
  if (input.field === 'leader' && value && next.state && !(await leaderInState(next.state, value))) {
    return { ok: false, status: 400, error: `"${value}" is not a ${next.state} leader` };
  }

  if (input.field === 'state') {
    if (next.state && next.location && !(await ensureStateLocation(client, next.state, next.location, false)).ok) next.location = null;
    if (next.state && next.leader && !(await leaderInState(next.state, next.leader))) next.leader = null;
    if (!next.state) { next.location = null; next.leader = null; }
  }

  const updates = { derived_state: next.state, derived_location: next.location, derived_leader: next.leader };
  const { error: updateError } = await client.from('campaign_reports').update(updates).eq('id', input.id);
  if (updateError) throw updateError;

  const audit = (['state', 'location', 'leader'] as const)
    .filter((f) => before[f] !== next[f])
    .map((f) => ({
      report_id: input.id, field: REPORT_FIELD_COLUMNS[f], old_value: before[f], new_value: next[f],
      edited_by: input.actor.userId, edited_by_label: input.actor.label,
    }));
  if (audit.length) {
    // The edit already succeeded; a failed audit write must not undo it, but must not be silent either.
    const { error } = await client.from('campaign_report_edits').insert(audit);
    if (error) console.error('[campaignReportManageService] audit insert failed:', error);
  }

  return { ok: true, report: { id: input.id, state: next.state, location: next.location, matchedLeader: next.leader } };
}

export async function getEditLog(client: SupabaseClient, page: number): Promise<ReportEditLogResponse> {
  const safePage = Math.max(1, Math.floor(page) || 1);
  const from = (safePage - 1) * EDIT_LOG_PAGE_SIZE;
  const { data, error, count } = await client
    .from('campaign_report_edits')
    .select('id, report_id, field, old_value, new_value, edited_by_label, edited_at', { count: 'exact' })
    .order('edited_at', { ascending: false })
    .range(from, from + EDIT_LOG_PAGE_SIZE - 1);
  if (error) throw error;

  const ids = [...new Set((data ?? []).map((e) => e.report_id as string))];
  const context = new Map<string, { locationTyped: string | null; leader: string | null }>();
  if (ids.length) {
    const { data: reports, error: rErr } = await client.from('campaign_reports').select('id, location_raw, leader_raw').in('id', ids);
    if (rErr) throw rErr;
    for (const r of reports ?? []) context.set(r.id as string, { locationTyped: r.location_raw as string | null, leader: r.leader_raw as string | null });
  }

  return {
    entries: (data ?? []).map((e) => ({
      id: e.id as string,
      editedAt: e.edited_at as string,
      editedBy: e.edited_by_label as string | null,
      field: e.field as string,
      oldValue: e.old_value as string | null,
      newValue: e.new_value as string | null,
      locationTyped: context.get(e.report_id as string)?.locationTyped ?? null,
      leader: context.get(e.report_id as string)?.leader ?? null,
    })),
    page: safePage,
    pageSize: EDIT_LOG_PAGE_SIZE,
    total: count ?? 0,
  };
}
