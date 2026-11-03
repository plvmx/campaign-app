/**
 * Registry portal — paginated trace of what ac-sync did with each form
 * submission it received from ActiveCampaign, newest first (the outcome rules
 * live in lib/registryPipeline/registrationLog.ts). Powers
 * /registry/manage/registration-log, so an admin can see for any recent
 * registration whether it created a new registrant, updated an existing one,
 * landed in the separate Way of Life responders table, or was skipped.
 *
 * Reads staging.ac_events (the raw landing zone) and joins what it produced
 * in registry.registration_events / registrants / twol_respondents. Query
 * params: page, view (registrations | responders | skipped | all), q (name or
 * email contains).
 *
 * Admin-only, same gate as manage-summary/manage-edit-log/manage-whatsapp-invite-log.
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { enforceOrigin } from '@/lib/corsUtils';
import { verifyRegistryAdminRequest } from '@/lib/registryServerAuth';
import { isNationalRegistryAdmin } from '@/lib/registryPipeline/mfaGate';
import { deriveRegistrationOutcome, parseRegistrationLogView, sanitizeSearchTerm } from '@/lib/registryPipeline/registrationLog';
import type { RegistrationLogEntry, RegistrationLogResponse } from '@/lib/registryPipeline/manageSummaryTypes';

const PAGE_SIZE = 50;

interface StagingRow {
  id: number;
  source_list_id: string;
  received_at: string;
  processed_at: string | null;
  processing_error: string | null;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  contact_created: string | null;
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

  const params = request.nextUrl.searchParams;
  const pageParam = Number(params.get('page') ?? '1');
  const page = Number.isFinite(pageParam) && pageParam >= 1 ? Math.floor(pageParam) : 1;
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;
  const view = parseRegistrationLogView(params.get('view'));
  const search = sanitizeSearchTerm(params.get('q'));

  try {
    let query = supabaseAdmin
      .schema('staging')
      .from('ac_events')
      .select(
        'id, source_list_id, received_at, processed_at, processing_error, email:raw_payload->contact->>email, first_name:raw_payload->contact->>firstName, last_name:raw_payload->contact->>lastName, contact_created:raw_payload->contact->>cdate',
        { count: 'exact' },
      );

    if (view === 'registrations') query = query.eq('source_list_id', '1').is('processing_error', null);
    else if (view === 'responders') query = query.eq('source_list_id', '2').is('processing_error', null);
    else if (view === 'skipped') query = query.not('processing_error', 'is', null);

    if (search) {
      query = query.or(
        `raw_payload->contact->>email.ilike.%${search}%,raw_payload->contact->>lastName.ilike.%${search}%,raw_payload->contact->>firstName.ilike.%${search}%`,
      );
    }

    const { data, count, error } = await query.order('id', { ascending: false }).range(from, to);
    if (error) throw error;

    const rows = (data ?? []) as unknown as StagingRow[];
    const ids = rows.map((r) => r.id);

    const registrantByEvent = new Map<number, string>();
    const responderEvents = new Set<number>();
    const registrantById = new Map<string, { firstSeenAt: string; state: string | null; registeredAt: string | null }>();

    if (ids.length > 0) {
      const [eventsRes, respondersRes] = await Promise.all([
        supabaseAdmin.schema('registry').from('registration_events').select('raw_staging_id, registrant_id').in('raw_staging_id', ids),
        supabaseAdmin.schema('registry').from('twol_respondents').select('raw_staging_id').in('raw_staging_id', ids),
      ]);
      if (eventsRes.error) throw eventsRes.error;
      if (respondersRes.error) throw respondersRes.error;

      for (const e of eventsRes.data ?? []) registrantByEvent.set(e.raw_staging_id as number, e.registrant_id as string);
      for (const r of respondersRes.data ?? []) responderEvents.add(r.raw_staging_id as number);

      const registrantIds = [...new Set(registrantByEvent.values())];
      if (registrantIds.length > 0) {
        const { data: regs, error: regError } = await supabaseAdmin
          .schema('registry')
          .from('registrants')
          .select('id, first_seen_at, state, registered_at')
          .in('id', registrantIds);
        if (regError) throw regError;
        for (const r of regs ?? []) {
          registrantById.set(r.id as string, { firstSeenAt: r.first_seen_at as string, state: r.state as string | null, registeredAt: r.registered_at as string | null });
        }
      }
    }

    const entries: RegistrationLogEntry[] = rows.map((row) => {
      const registrantId = registrantByEvent.get(row.id);
      const registrant = registrantId ? registrantById.get(registrantId) ?? null : null;
      return {
        id: row.id,
        receivedAt: row.received_at,
        listId: row.source_list_id,
        outcome: deriveRegistrationOutcome({
          processedAt: row.processed_at,
          processingError: row.processing_error,
          hasResponderRow: responderEvents.has(row.id),
          registrant: registrant ? { firstSeenAt: registrant.firstSeenAt } : null,
        }),
        firstName: row.first_name,
        lastName: row.last_name,
        email: row.email,
        contactCreatedAt: row.contact_created,
        registrant: registrant ? { state: registrant.state, registeredAt: registrant.registeredAt } : null,
      };
    });

    const body: RegistrationLogResponse = { entries, totalCount: count ?? 0 };
    return NextResponse.json(body);
  } catch (err) {
    console.error('[registry/manage-registration-log] failed:', err);
    return NextResponse.json({ error: 'Failed to load the registration log' }, { status: 500 });
  }
}
