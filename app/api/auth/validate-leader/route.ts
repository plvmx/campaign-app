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

    const { data, error } = await supabaseAdmin
      .from('state_leaders')
      .select('id, state, leader, mobile, admin');

    if (error) {
      console.error('validate-leader API error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (!data || data.length === 0) {
      return NextResponse.json({ match: null });
    }

    const match = data.find((rec: { mobile?: string; leader?: string }) => {
      const mobileValue = rec.mobile;
      if (!mobileValue) return false;
      const recordMobileNormalized = normalizeMobile(mobileValue);
      const recordNameNormalized = normalizeName(rec.leader ?? '');
      return recordMobileNormalized === mobileNormalized && recordNameNormalized === firstNameNormalized;
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
