import { supabase } from '@/lib/supabaseClient';
import type {
  EditableReportField, ManageDataResponse, ReportEditLogResponse, ReportEditResponse,
} from '@/lib/campaignReportManageTypes';

async function authHeaders(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` };
}

/** Thrown by saveReportEdit when the location isn't in State Places yet, so the screen can offer to add it. */
export class UnknownLocationError extends Error {}

/** Browser-side wrappers for /api/admin/campaign-reports/{manage,edit-log}. */
export async function fetchManageData(): Promise<ManageDataResponse> {
  const res = await fetch('/api/admin/campaign-reports/manage', { headers: await authHeaders() });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Failed to load (${res.status})`);
  return body as ManageDataResponse;
}

export async function saveReportEdit(
  id: string, field: EditableReportField, value: string | null, addLocation = false,
): Promise<ReportEditResponse> {
  const res = await fetch('/api/admin/campaign-reports/manage', {
    method: 'PATCH', headers: await authHeaders(), body: JSON.stringify({ id, field, value, addLocation }),
  });
  const body = await res.json().catch(() => ({}));
  if (res.status === 409 && body.code === 'unknown_location') throw new UnknownLocationError(body.error);
  if (!res.ok) throw new Error(body.error || `Failed to save (${res.status})`);
  return body as ReportEditResponse;
}

export async function fetchEditLog(page: number): Promise<ReportEditLogResponse> {
  const res = await fetch(`/api/admin/campaign-reports/edit-log?page=${page}`, { headers: await authHeaders() });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Failed to load (${res.status})`);
  return body as ReportEditLogResponse;
}
