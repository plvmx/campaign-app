/**
 * Report Generator
 *
 * Fetches campaign results for a date range, renders them as JPEG pages via
 * lib/reportCanvas, packages them into a ZIP, and triggers a browser download.
 *
 * Used by:
 *   - app/admin/generate-report/page.tsx  (for the "Download JPEG" button)
 *   - app/app/page.tsx admin quick-action  (uses pastCampaignStart week)
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import JSZip from 'jszip';
import { drawReportPage, canvasToJpegBlob } from '@/lib/reportCanvas';
import { formatDownloadDate } from '@/lib/slideLayout';

const LINES_PER_JPEG = 12;

// ---------------------------------------------------------------------------
// Types (mirrored from generate-report/page.tsx)
// ---------------------------------------------------------------------------

interface ReportCampaign {
  id: string;
  date: string;
  state: string;
  place: string;
}

interface ReportResult {
  campaign_id: string;
  first_name: string;
  category_code: 'P' | 'F' | 'SP' | 'IR';
  created_at: string;
}

export interface ReportRow {
  dateLocation: string;
  fpAndSp: string[];
  fpOnly: string[];
  pp: string[];
}

export interface GenerateReportOptions {
  supabase: SupabaseClient;
  /** Inclusive start date in YYYY-MM-DD format. */
  startDate: string;
  /** Inclusive end date in YYYY-MM-DD format. */
  endDate: string;
  adminStatus?: string | null;
  userState?: string | null;
}

// ---------------------------------------------------------------------------
// Data fetching
// ---------------------------------------------------------------------------

async function fetchReportRows(options: GenerateReportOptions): Promise<ReportRow[]> {
  const { supabase: client, startDate, endDate, adminStatus, userState } = options;

  let campaignsQ = client
    .from('campaigns')
    .select('id, date, state, place')
    .gte('date', startDate)
    .lte('date', endDate)
    .order('date',  { ascending: true })
    .order('state', { ascending: true })
    .order('place', { ascending: true });

  if (adminStatus === 'SR' && userState) {
    campaignsQ = campaignsQ.eq('state', userState.toUpperCase().trim());
  }

  const { data: campaigns, error: campaignsError } = await campaignsQ;
  if (campaignsError) throw campaignsError;
  if (!campaigns || campaigns.length === 0) {
    throw new Error('No campaigns found in the selected date range.');
  }

  const campaignIds = (campaigns as ReportCampaign[]).map(c => c.id);
  const { data: results, error: resultsError } = await client
    .from('results')
    .select('campaign_id, first_name, category_code, created_at')
    .in('campaign_id', campaignIds)
    .order('created_at', { ascending: true });
  if (resultsError) throw resultsError;

  const byId = new Map<string, ReportResult[]>();
  (results ?? []).forEach((r: ReportResult) => {
    if (!byId.has(r.campaign_id)) byId.set(r.campaign_id, []);
    byId.get(r.campaign_id)!.push(r);
  });

  const rows: ReportRow[] = (campaigns as ReportCampaign[])
    .map(c => {
      const d = new Date(c.date);
      const dateLocation = `${d.getDate()}/${d.getMonth() + 1} ${c.place} ${c.state}`;
      const fpAndSp: string[] = [];
      const fpOnly:  string[] = [];
      const pp:      string[] = [];

      (byId.get(c.id) ?? []).forEach(r => {
        switch (r.category_code) {
          case 'SP': fpAndSp.push(r.first_name); break;
          case 'F':  fpOnly.push(r.first_name);  break;
          case 'P':  pp.push(r.first_name);       break;
        }
      });

      return { dateLocation, fpAndSp, fpOnly, pp };
    })
    .filter(row => row.fpAndSp.length > 0 || row.fpOnly.length > 0 || row.pp.length > 0);

  if (rows.length === 0) {
    throw new Error('No results recorded for the selected date range.');
  }

  return rows;
}

// ---------------------------------------------------------------------------
// ZIP render + download
// ---------------------------------------------------------------------------

/**
 * Renders an array of already-built ReportRows to JPEG pages and downloads as ZIP.
 * Used by the generate-report page where rows may have been manually edited.
 */
export async function downloadReportRows(rows: ReportRow[]): Promise<void> {
  const chunkCount = Math.ceil(rows.length / LINES_PER_JPEG);
  const zip = new JSZip();
  const datePrefix = formatDownloadDate(new Date());

  for (let part = 0; part < chunkCount; part++) {
    const chunk  = rows.slice(part * LINES_PER_JPEG, (part + 1) * LINES_PER_JPEG);
    const canvas = drawReportPage(chunk);
    const blob   = await canvasToJpegBlob(canvas);
    const suffix = chunkCount > 1 ? `_part${part + 1}` : '';
    zip.file(
      `${datePrefix}_Campaign_Results${suffix}.jpeg`,
      await blob.arrayBuffer(),
    );
  }

  const zipBlob = await zip.generateAsync({ type: 'blob' });
  const url  = URL.createObjectURL(zipBlob);
  const link = document.createElement('a');
  link.href     = url;
  link.download = `${datePrefix}_Campaign_Results.zip`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Full pipeline: fetch campaigns + results for `startDate`–`endDate`,
 * render to JPEG pages, package as ZIP, and trigger a browser download.
 */
export async function generateAndDownloadReport(options: GenerateReportOptions): Promise<void> {
  const rows = await fetchReportRows(options);
  await downloadReportRows(rows);
}
