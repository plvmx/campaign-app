/**
 * Campaign Reports management screen (/admin/campaign-reports).
 *
 * GET   -> { reports, locations, leaders }  every report plus the State Places locations / leaders pick-lists
 * PATCH -> { id, field: 'state'|'location'|'leader', value, addLocation? }  one audited hand edit
 * Authorization: Bearer <supabase_access_token>  (caller must be a full admin with 2FA)
 * See lib/services/campaignReportManageService.ts.
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { authorizeAdminRequest } from '@/lib/adminRouteGuard';
import { applyReportEdit, getManageData } from '@/lib/services/campaignReportManageService';
import { EDITABLE_REPORT_FIELDS, type EditableReportField } from '@/lib/campaignReportManageTypes';
import { getErrorMessage } from '@/lib/errorUtils';

const LOG_TAG = 'admin/campaign-reports/manage';

export async function GET(request: NextRequest) {
  const auth = await authorizeAdminRequest(request, LOG_TAG);
  if (!auth.ok) return auth.response;
  try {
    return NextResponse.json(await getManageData(supabaseAdmin));
  } catch (err) {
    console.error(`[${LOG_TAG}] GET failed:`, err);
    return NextResponse.json({ error: getErrorMessage(err, 'Failed to load reports') }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  const auth = await authorizeAdminRequest(request, LOG_TAG);
  if (!auth.ok) return auth.response;

  let body: { id?: unknown; field?: unknown; value?: unknown; addLocation?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }
  if (typeof body.id !== 'string' || !body.id) return NextResponse.json({ error: 'id is required' }, { status: 400 });
  if (typeof body.field !== 'string' || !EDITABLE_REPORT_FIELDS.includes(body.field as EditableReportField)) {
    return NextResponse.json({ error: 'field must be state, location or leader' }, { status: 400 });
  }
  if (body.value !== null && typeof body.value !== 'string') {
    return NextResponse.json({ error: 'value must be a string or null' }, { status: 400 });
  }

  try {
    const result = await applyReportEdit(supabaseAdmin, {
      id: body.id,
      field: body.field as EditableReportField,
      value: body.value as string | null,
      addLocation: body.addLocation === true,
      actor: { userId: auth.userId, label: auth.label },
    });
    if (!result.ok) return NextResponse.json({ error: result.error, code: result.code }, { status: result.status });
    return NextResponse.json(result.report);
  } catch (err) {
    console.error(`[${LOG_TAG}] PATCH failed:`, err);
    return NextResponse.json({ error: getErrorMessage(err, 'Failed to save the edit') }, { status: 500 });
  }
}
