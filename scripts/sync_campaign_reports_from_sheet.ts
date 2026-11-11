/**
 * Campaign Report project — see docs/campaign-report/BRIEF.md.
 *
 * Runs the same sync the /api/cron/campaign-report-sync cron job runs, from a
 * terminal: pulls the live Google Sheet and inserts rows not yet in
 * `campaign_reports`, then derives state/place/leader for recent rows.
 * Existing rows are never modified by the insert step.
 *
 * Usage:
 *   npx tsx scripts/sync_campaign_reports_from_sheet.ts [sheetId]           # dry run
 *   npx tsx scripts/sync_campaign_reports_from_sheet.ts [sheetId] --apply   # write
 * sheetId defaults to CAMPAIGN_REPORT_SHEET_ID from .env.local.
 */
import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import { syncCampaignReportsFromSheet } from '../lib/services/campaignReportSyncService';

fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf-8').split('\n').forEach((line) => {
  const t = line.trim();
  if (!t || t.startsWith('#')) return;
  const [k, ...rest] = t.split('=');
  if (k && rest.length) process.env[k.trim()] = rest.join('=').trim().replace(/^["']|["']$/g, '');
});

const apply = process.argv.includes('--apply');
const sheetId = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? process.env.CAMPAIGN_REPORT_SHEET_ID;
if (!sheetId) {
  console.error('Pass the sheet id as an argument or set CAMPAIGN_REPORT_SHEET_ID in .env.local');
  process.exit(1);
}

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

syncCampaignReportsFromSheet(supabase, sheetId, { apply })
  .then((r) => {
    console.log(`${apply ? 'APPLIED' : 'DRY RUN'}:`, JSON.stringify(r, null, 2));
    if (!apply) console.log('\nRe-run with --apply to write.');
  })
  .catch((err) => { console.error(err); process.exit(1); });
