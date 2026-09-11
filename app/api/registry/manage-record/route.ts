/**
 * Registry portal — applies one hand-edit to a registry.registrants row
 * from the /registry/manage console's View/Edit toggle, and records it in
 * registry.registrant_edits (scripts/create_registry_registrant_edits_table.sql)
 * so every correction is attributable and reviewable later.
 *
 * Only the four fields in EDITABLE_REGISTRANT_FIELDS
 * (lib/registryPipeline/registrantValidation.ts) can ever be written here —
 * whitelisted and re-validated server-side, not just hidden in the UI,
 * since email/phone are the pipeline's own identity/dedup keys and must
 * never be hand-edited from this screen (see that module's header comment).
 *
 * Admin-only, same gate as /api/registry/manage-summary — see that route's
 * header comment for the reasoning.
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { enforceOrigin } from '@/lib/corsUtils';
import { verifyRegistryAdminRequest } from '@/lib/registryServerAuth';
import { isNationalRegistryAdmin } from '@/lib/registryPipeline/mfaGate';
import {
  EDITABLE_FIELD_COLUMNS,
  isEditableRegistrantField,
  isValidRegistrantFieldValue,
} from '@/lib/registryPipeline/registrantValidation';
import type { ManageRecordEditResponse } from '@/lib/registryPipeline/manageSummaryTypes';

export async function PATCH(request: NextRequest) {
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

  let body: { id?: unknown; field?: unknown; value?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { id, field, value } = body;
  if (typeof id !== 'string' || !id) {
    return NextResponse.json({ error: 'id is required' }, { status: 400 });
  }
  if (typeof field !== 'string' || !isEditableRegistrantField(field)) {
    return NextResponse.json({ error: 'field must be one of firstName, lastName, state, postcode' }, { status: 400 });
  }
  if (value !== null && typeof value !== 'string') {
    return NextResponse.json({ error: 'value must be a string or null' }, { status: 400 });
  }

  // A blank string clears the field — normalized to null so the DB stores
  // NULL, not '', matching every other writer of this table.
  const normalized = value === null || value.trim() === '' ? null : value.trim();
  if (!isValidRegistrantFieldValue(field, normalized)) {
    return NextResponse.json({ error: `Invalid value for ${field}` }, { status: 400 });
  }

  const column = EDITABLE_FIELD_COLUMNS[field];

  try {
    // Selecting the full set of editable columns (rather than building a
    // select() string from `column` dynamically) keeps this statically
    // typed — supabase-js can't type-check a runtime-computed column list.
    const { data: existing, error: fetchError } = await supabaseAdmin
      .schema('registry')
      .from('registrants')
      .select('first_name, last_name, state, postcode')
      .eq('id', id)
      .maybeSingle();
    if (fetchError) throw fetchError;
    if (!existing) {
      return NextResponse.json({ error: 'Registrant not found' }, { status: 404 });
    }
    const oldValue = (existing as Record<string, string | null>)[column];

    const { error: updateError } = await supabaseAdmin
      .schema('registry')
      .from('registrants')
      .update({ [column]: normalized, last_updated_at: new Date().toISOString() })
      .eq('id', id);
    if (updateError) throw updateError;

    const { error: auditError } = await supabaseAdmin
      .schema('registry')
      .from('registrant_edits')
      .insert({
        registrant_id: id,
        field: column,
        old_value: oldValue,
        new_value: normalized,
        edited_by: verified.userId,
        edited_by_email: verified.email,
      });
    // The edit itself already succeeded and passed validation — don't roll
    // it back over a failed audit-log write, but never let that failure be
    // silent, since attributability is the entire point of that table.
    if (auditError) {
      console.error('[registry/manage-record] audit log insert failed:', auditError);
    }

    const responseBody: ManageRecordEditResponse = { id, field, value: normalized };
    return NextResponse.json(responseBody);
  } catch (err) {
    console.error('[registry/manage-record] failed:', err);
    return NextResponse.json({ error: 'Failed to save the edit' }, { status: 500 });
  }
}
