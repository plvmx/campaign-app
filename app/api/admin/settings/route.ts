/**
 * Server-side admin settings mutation.
 * POST body: { key: string, value: string, description?: string }
 * Authorization: Bearer <supabase_access_token>
 *
 * Verifies the caller is an authenticated admin before writing to app_settings.
 * This ensures settings cannot be mutated by non-admins even if Supabase RLS
 * is misconfigured, because the write goes through the service-role client only
 * after server-side admin verification.
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { enforceOrigin } from '@/lib/corsUtils';
import { verifyAdminCaller } from '@/lib/services/adminCallerService';
import { normalizeHotkey } from '@/lib/techInsights/hotkey';
import { TECH_INSIGHTS_ENABLED_KEY, TECH_INSIGHTS_HOTKEY_KEY } from '@/lib/techInsights/settings';
import { PUBLIC_LINKS, publicLinkTitleSettingKey, publicLinkDescriptionSettingKey } from '@/lib/publicLinks';

// Public link keys are derived from PUBLIC_LINKS so a new entry there is
// automatically writable here too, without touching this allowlist.
const ALLOWED_SETTING_KEYS = new Set([
  'campaign_logging_enabled',
  'slide_view_leaders',
  'slide_view_sr',
  'slide_view_admin',
  TECH_INSIGHTS_ENABLED_KEY,
  TECH_INSIGHTS_HOTKEY_KEY,
  ...PUBLIC_LINKS.flatMap((link) => [publicLinkTitleSettingKey(link.slug), publicLinkDescriptionSettingKey(link.slug)]),
]);

const MAX_VALUE_LENGTH = 2000;

export async function POST(request: NextRequest) {
  const corsBlock = enforceOrigin(request);
  if (corsBlock) return corsBlock;

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('[admin/settings] SUPABASE_SERVICE_ROLE_KEY is not set');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }

  // Extract Bearer token from Authorization header
  const authHeader = request.headers.get('authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Full admin (AD) signed in with 2FA — shared check, see lib/services/adminCallerService.ts.
  const caller = await verifyAdminCaller(supabaseAdmin, token);
  if (!caller.ok) {
    return NextResponse.json({ error: caller.error }, { status: caller.status });
  }

  // Parse and validate the body
  let body: { key?: unknown; value?: unknown; description?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const key         = typeof body.key         === 'string' ? body.key         : null;
  const value       = typeof body.value       === 'string' ? body.value       : null;
  const description = typeof body.description === 'string' ? body.description : null;

  if (!key || value === null) {
    return NextResponse.json({ error: 'Missing key or value' }, { status: 400 });
  }

  if (value.length > MAX_VALUE_LENGTH) {
    return NextResponse.json({ error: `Value too long (max ${MAX_VALUE_LENGTH} characters)` }, { status: 400 });
  }

  // Allowlist of valid setting keys — prevents writing arbitrary rows
  if (!ALLOWED_SETTING_KEYS.has(key)) {
    return NextResponse.json({ error: 'Unknown setting key' }, { status: 400 });
  }

  // A malformed shortcut or flag would silently disable (or mis-bind) Tech Insights for every admin.
  if (key === TECH_INSIGHTS_HOTKEY_KEY && normalizeHotkey(value) !== value) {
    return NextResponse.json({ error: 'Invalid keyboard shortcut' }, { status: 400 });
  }
  if (key === TECH_INSIGHTS_ENABLED_KEY && value !== 'true' && value !== 'false') {
    return NextResponse.json({ error: 'Value must be true or false' }, { status: 400 });
  }

  const { error: upsertError } = await supabaseAdmin
    .from('app_settings')
    .upsert(
      { setting_key: key, setting_value: value, ...(description ? { description } : {}) },
      { onConflict: 'setting_key' },
    );

  if (upsertError) {
    console.error('[admin/settings] upsert error:', upsertError);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
