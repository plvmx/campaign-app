/**
 * Registry portal — paginated read of registry.registrant_edits (the audit
 * trail of manual corrections made from /registry/manage's Edit mode — see
 * scripts/create_registry_registrant_edits_table.sql), joined with the
 * registrant each row was about. Powers /registry/manage/edit-log.
 *
 * Admin-only, same gate as manage-summary/manage-record.
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { enforceOrigin } from '@/lib/corsUtils';
import { verifyRegistryAdminRequest } from '@/lib/registryServerAuth';
import { isNationalRegistryAdmin } from '@/lib/registryPipeline/mfaGate';
import type { RegistrantEditLogEntry, RegistrantEditLogResponse } from '@/lib/registryPipeline/manageSummaryTypes';

const PAGE_SIZE = 50;

interface EmbeddedRegistrant {
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  state: string | null;
}

interface RegistrantEditRow {
  id: number;
  field: string;
  old_value: string | null;
  new_value: string | null;
  edited_by_email: string | null;
  edited_at: string;
  // supabase-js's embed shape for a to-one relation is usually a single
  // object, but isn't guaranteed by this client's (ungenerated) types —
  // handled as either below rather than trusted blindly.
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
      .from('registrant_edits')
      .select('id, field, old_value, new_value, edited_by_email, edited_at, registrants(first_name, last_name, email, state)', { count: 'exact' })
      .order('edited_at', { ascending: false })
      .range(from, to);
    if (error) throw error;

    const rows = (data ?? []) as unknown as RegistrantEditRow[];
    const entries: RegistrantEditLogEntry[] = rows.map((row) => {
      const embedded = Array.isArray(row.registrants) ? row.registrants[0] ?? null : row.registrants;
      return {
        id: row.id,
        field: row.field,
        oldValue: row.old_value,
        newValue: row.new_value,
        editedByEmail: row.edited_by_email,
        editedAt: row.edited_at,
        registrant: embedded
          ? { firstName: embedded.first_name, lastName: embedded.last_name, email: embedded.email, state: embedded.state }
          : null,
      };
    });

    const body: RegistrantEditLogResponse = { entries, totalCount: count ?? 0 };
    return NextResponse.json(body);
  } catch (err) {
    console.error('[registry/manage-edit-log] failed:', err);
    return NextResponse.json({ error: 'Failed to load the edit log' }, { status: 500 });
  }
}
