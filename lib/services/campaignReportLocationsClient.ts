import { supabase } from '@/lib/supabaseClient';
import type { UnresolvedLocationsResult } from '@/lib/services/campaignReportLocationsService';

async function authHeaders(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` };
}

/** Browser-side wrappers for /api/admin/campaign-reports/locations. */
export async function fetchUnresolvedLocations(): Promise<UnresolvedLocationsResult> {
  const res = await fetch('/api/admin/campaign-reports/locations', { headers: await authHeaders() });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Failed to load (${res.status})`);
  return body as UnresolvedLocationsResult;
}

export async function saveLocationMapping(input: {
  locationKey: string; state: string; place?: string | null; newPlace?: string | null;
}): Promise<number> {
  const res = await fetch('/api/admin/campaign-reports/locations', {
    method: 'POST', headers: await authHeaders(), body: JSON.stringify(input),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Failed to save (${res.status})`);
  return body.rowsUpdated as number;
}
