import { supabase } from '@/lib/supabaseClient';
import type { TechInsightsManifest } from './types';

async function authedGet(url: string): Promise<Record<string, unknown>> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not signed in');
  const res = await fetch(url, { headers: { Authorization: `Bearer ${session.access_token}` } });
  const json = await res.json().catch(() => ({})) as Record<string, unknown>;
  if (!res.ok) throw new Error((json.error as string | undefined) || `Request failed (${res.status})`);
  return json;
}

/** Browser-side call to GET /api/admin/tech-insights. Throws with the server's message on failure. */
export async function fetchTechInsightsManifest(): Promise<TechInsightsManifest> {
  return (await authedGet('/api/admin/tech-insights')).manifest as TechInsightsManifest;
}

export async function fetchTechInsightsSource(path: string): Promise<string> {
  return (await authedGet(`/api/admin/tech-insights?file=${encodeURIComponent(path)}`)).source as string;
}
