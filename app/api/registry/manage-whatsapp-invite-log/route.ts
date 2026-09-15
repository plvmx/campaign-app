/**
 * Registry portal — paginated read of registry.whatsapp_invite_log (the
 * audit trail of every WhatsApp-invite email attempt made by ac-sync's
 * transform.ts — see scripts/create_registry_whatsapp_invite_log_table.sql),
 * joined with the registrant each row was for. Powers
 * /registry/manage/whatsapp-invite-log. Same shape/gate as
 * manage-edit-log/route.ts.
 *
 * Admin-only, same gate as manage-summary/manage-record/manage-edit-log.
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { enforceOrigin } from '@/lib/corsUtils';
import { verifyRegistryAdminRequest } from '@/lib/registryServerAuth';
import { isNationalRegistryAdmin } from '@/lib/registryPipeline/mfaGate';
import type { WhatsAppInviteLogEntry, WhatsAppInviteLogResponse } from '@/lib/registryPipeline/manageSummaryTypes';

const PAGE_SIZE = 50;

interface EmbeddedRegistrant {
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  state: string | null;
}

interface WhatsAppInviteLogRow {
  id: number;
  status: 'sent' | 'failed' | 'skipped_no_link';
  error: string | null;
  resend_message_id: string | null;
  included_campaigns_near_me_link: boolean;
  attempted_at: string;
  // supabase-js's embed shape for a to-one relation is usually a single
  // object, but isn't guaranteed by this client's (ungenerated) types —
  // handled as either below rather than trusted blindly (same as
  // manage-edit-log/route.ts).
  registrants: EmbeddedRegistrant | EmbeddedRegistrant[] | null;
}

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

  const pageParam = Number(request.nextUrl.searchParams.get('page') ?? '1');
  const page = Number.isFinite(pageParam) && pageParam >= 1 ? Math.floor(pageParam) : 1;
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  try {
    const { data, count, error } = await supabaseAdmin
      .schema('registry')
      .from('whatsapp_invite_log')
      .select('id, status, error, resend_message_id, included_campaigns_near_me_link, attempted_at, registrants(first_name, last_name, email, state)', { count: 'exact' })
      .order('attempted_at', { ascending: false })
      .range(from, to);
    if (error) throw error;

    const rows = (data ?? []) as unknown as WhatsAppInviteLogRow[];
    const entries: WhatsAppInviteLogEntry[] = rows.map((row) => {
      const embedded = Array.isArray(row.registrants) ? row.registrants[0] ?? null : row.registrants;
      return {
        id: row.id,
        status: row.status,
        error: row.error,
        resendMessageId: row.resend_message_id,
        includedCampaignsNearMeLink: row.included_campaigns_near_me_link,
        attemptedAt: row.attempted_at,
        registrant: embedded
          ? { firstName: embedded.first_name, lastName: embedded.last_name, email: embedded.email, state: embedded.state }
          : null,
      };
    });

    const body: WhatsAppInviteLogResponse = { entries, totalCount: count ?? 0 };
    return NextResponse.json(body);
  } catch (err) {
    console.error('[registry/manage-whatsapp-invite-log] failed:', err);
    return NextResponse.json({ error: 'Failed to load the WhatsApp invite log' }, { status: 500 });
  }
}
