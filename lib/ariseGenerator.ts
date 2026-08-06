/**
 * Week 1 Campaigns List Generator — public API and data fetching.
 * Layout constants live in ariseLayout.ts; canvas helpers in ariseCanvas.ts.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { formatDownloadDate } from '@/lib/slideLayout';
import { renderAriseCanvas } from '@/lib/ariseCanvas';
import type { AriseCampaign } from '@/lib/ariseLayout';

// ---------------------------------------------------------------------------
// Data fetching
// ---------------------------------------------------------------------------

async function fetchCampaignsForDate(
  client: SupabaseClient,
  date: Date,
  filterState: string | null,
): Promise<AriseCampaign[]> {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');

  let q = client
    .from('campaigns')
    .select('id, date, state, place, site, time, leader, category')
    .eq('date', `${y}-${m}-${d}`)
    .order('state', { ascending: true })
    .order('place', { ascending: true })
    .order('time',  { ascending: true });

  if (filterState) {
    q = q.eq('state', filterState);
  }

  const { data } = await q;
  return (data ?? []) as AriseCampaign[];
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface GenerateAriseOptions {
  supabase: SupabaseClient;
  /** First Monday of the two-week window. */
  startDate: Date;
  adminStatus?: string | null;
  userState?: string | null;
  /** Explicit state to filter to, chosen by a full admin. Overrides the SR role-based filter. */
  stateFilter?: string | null;
  onProgress?: (msg: string) => void;
}

/**
 * Fetches campaign data, renders the Week 1 Campaigns list as a landscape
 * JPEG, and triggers a browser download.
 */
export async function generateAndDownloadAriseList(options: GenerateAriseOptions): Promise<void> {
  const { supabase: client, startDate, adminStatus, userState, stateFilter, onProgress } = options;

  const explicitState = stateFilter && stateFilter.trim() ? stateFilter.toUpperCase().trim() : null;
  const roleState = adminStatus === 'SR' && userState ? userState.toUpperCase().trim() : null;
  const filterState = explicitState || roleState;

  // Build the 8 date targets: week-1 days 0–6, week-2 Mon = day 7
  const dates = Array.from({ length: 8 }, (_, i) => {
    const d = new Date(startDate);
    d.setDate(d.getDate() + i);
    return d;
  });

  onProgress?.('Fetching Week 1 campaign data…');
  const allCampaigns: AriseCampaign[][] = [];
  for (let i = 0; i < dates.length; i++) {
    onProgress?.(`Fetching day ${i + 1} of ${dates.length}…`);
    allCampaigns.push(await fetchCampaignsForDate(client, dates[i], filterState));
  }

  const canvas = await renderAriseCanvas(allCampaigns, dates, onProgress);

  onProgress?.('Creating JPEG…');
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      b => (b ? resolve(b) : reject(new Error('Failed to create JPEG blob'))),
      'image/jpeg',
      0.95,
    );
  });

  const url  = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href     = url;
  link.download = `${formatDownloadDate(new Date())}_Week1_Campaigns${explicitState ? `_${explicitState}` : ''}.jpg`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);

  onProgress?.('Done — Week 1 Campaigns list downloaded.');
}
