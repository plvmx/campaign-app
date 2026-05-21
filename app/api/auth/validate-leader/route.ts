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

    const match = data.find((rec: { mobile?: string; leader?: string }) => {
      // Normalise the stored name (trim + lowercase) so extra whitespace in the DB
      // doesn't prevent a valid login.
      const storedNameNormalized = normalizeName(rec.leader ?? '');
      if (storedNameNormalized !== firstNameNormalized) return false;

      const mobileValue = rec.mobile;
      if (!mobileValue) return false;
      const recordMobileNormalized = normalizeMobile(mobileValue);
      return recordMobileNormalized === mobileNormalized;
    });

    if (!match) {
      return NextResponse.json({ match: null });
    }

    return NextResponse.json({
      match: {
        id: match.id,
        state: match.state,
        leader: match.leader,
        admin: match.admin,
      },
    });
  } catch (err) {
    console.error('validate-leader API exception:', err);
    return NextResponse.json({ error: 'Validation failed' }, { status: 500 });
  }
}
