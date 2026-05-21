/**
 * Server-side login validation. Uses service role to bypass RLS.
 * POST body: { mobile: string, firstName: string }
 * Returns: { match: { id, state, leader, admin } | null }
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { normalizeMobile, normalizeName } from '@/lib/auth';

export async function POST(request: NextRequest) {
  try {
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
      console.error('SUPABASE_SERVICE_ROLE_KEY is not set');
      return NextResponse.json(
        { error: 'Server configuration error: missing SUPABASE_SERVICE_ROLE_KEY' },
        { status: 500 }
      );
    }

    const body = await request.json();
    const mobile = typeof body.mobile === 'string' ? body.mobile : '';
    const firstName = typeof body.firstName === 'string' ? body.firstName : '';

    const mobileNormalized = normalizeMobile(mobile);
    const firstNameNormalized = normalizeName(firstName);

    if (!mobileNormalized || !firstNameNormalized) {
      return NextResponse.json({ match: null });
    }

    // Use a wildcard ilike to cast a wide net at the DB level — this tolerates leading/
    // trailing whitespace in stored names (e.g. "Rosheen " stored with a trailing space).
    // The JS layer below then verifies the normalised first-name matches exactly, so a
    // stored full name like "Rosheen Thompson" will NOT match a login attempt of "Rosheen".
    const { data, error } = await supabaseAdmin
      .from('state_leaders')
      .select('id, state, leader, mobile, admin')
      .ilike('leader', `%${firstNameNormalized}%`);

    if (error) {
      console.error('validate-leader API error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (!data || data.length === 0) {
      return NextResponse.json({ match: null });
    }

    // Collect ALL records that pass the name + mobile check so the client can
    // present a state-picker when a leader has records in multiple states.
    const matches = data.filter((rec: { mobile?: string; leader?: string }) => {
      const storedNameNormalized = normalizeName(rec.leader ?? '');
      if (storedNameNormalized !== firstNameNormalized) return false;
      const mobileValue = rec.mobile;
      if (!mobileValue) return false;
      return normalizeMobile(mobileValue) === mobileNormalized;
    });

    return NextResponse.json({
      matches: matches.map((m: { id: string; state: string; leader: string; admin: string | null }) => ({
        id:     m.id,
        state:  m.state,
        leader: m.leader,
        admin:  m.admin,
      })),
    });
  } catch (err) {
    console.error('validate-leader API exception:', err);
    return NextResponse.json({ error: 'Validation failed' }, { status: 500 });
  }
}
