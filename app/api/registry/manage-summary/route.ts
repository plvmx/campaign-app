/**
 * Registry portal — data for the Manage console (app/registry/manage/page.tsx).
 *
 * Returns the most recent registry.sync_log row (whatever a national admin
 * needs to answer "when did the cron job last run, and did it succeed") and
 * every registry.registrants row's state + registered_at — just enough for
 * the console's per-state/per-period tallying (lib/registryPipeline/
 * registrantCounts.ts, run client-side so the two filter dropdowns update
 * instantly without a round trip per change). No PII leaves this route:
 * no name, email, or phone is selected.
 *
 * ~9,100 registrants as of the 2026-09 reload (see
 * scripts/backup_registrants_before_reload.ts), growing by a handful a day
 * via ac-sync — small enough to page through and return whole. Revisit with
 * server-side aggregation if that ever stops being true.
 *
 * Admin-only: verifyRegistryAdminRequest() proves the caller cleared the
 * MFA gate, and isNationalRegistryAdmin() further restricts this to
 * national_admin/whatsapp_admin — a state_leader has no need for national
 * totals across every state and isn't shown the Manage button that links
 * here (app/registry/page.tsx), so this is defense in depth for that same
 * rule, not a separate decision.
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { enforceOrigin } from '@/lib/corsUtils';
import { verifyRegistryAdminRequest } from '@/lib/registryServerAuth';
import { isNationalRegistryAdmin } from '@/lib/registryPipeline/mfaGate';
import type { ManageSummaryResponse, RegistrantStateRow, SyncLogSummary } from '@/lib/registryPipeline/manageSummaryTypes';

const PAGE_SIZE = 1000;

export async function GET(request: NextRequest) {
  const corsBlock = enforceOrigin(request);
  if (corsBlock) return corsBlock;

  const authHeader = request.headers.get('authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const verified = await verifyRegistryAdminRequest(supabaseAdmin, token);
  if (!verified || !isNationalRegistryAdmin(verified.leaderRole.role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { data: syncRow, error: syncError } = await supabaseAdmin
      .schema('registry')
      .from('sync_log')
      .select('started_at, completed_at, status, records_in, records_upserted, errors, notes')
      .eq('run_type', 'sync')
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (syncError) throw syncError;

    const lastSync: SyncLogSummary | null = syncRow
      ? {
          startedAt: syncRow.started_at,
          completedAt: syncRow.completed_at,
          status: syncRow.status,
          recordsIn: syncRow.records_in,
          recordsUpserted: syncRow.records_upserted,
          errors: syncRow.errors,
          notes: syncRow.notes,
        }
      : null;

    const registrants: RegistrantStateRow[] = [];
    for (let offset = 0; ; offset += PAGE_SIZE) {
      const { data, error } = await supabaseAdmin
        .schema('registry')
        .from('registrants')
        .select('state, registered_at')
        .range(offset, offset + PAGE_SIZE - 1);
      if (error) throw error;
      if (!data || data.length === 0) break;
      registrants.push(...data.map((r) => ({ state: r.state, registeredAt: r.registered_at })));
      if (data.length < PAGE_SIZE) break;
    }

    const body: ManageSummaryResponse = { lastSync, registrants };
    return NextResponse.json(body);
  } catch (err) {
    console.error('[registry/manage-summary] failed:', err);
    return NextResponse.json({ error: 'Failed to load registry management summary' }, { status: 500 });
  }
}
