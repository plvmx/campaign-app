import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { normalizePhone } from '@/lib/registryPipeline/phone';

/**
 * Looks up a candidate email for a leader by cross-referencing their mobile
 * number against registry.registrants — the same phone-matching approach
 * lib/registryPipeline/leaderMatch.ts already uses for an informational
 * "is this registrant a leader" cross-reference, applied here in reverse.
 *
 * This is a pre-fill SUGGESTION only, shown to the leader to confirm or
 * edit — never written to state_leaders.email directly. registry.registrants
 * has no reliable identity key back to a specific state_leaders row (see
 * leaderMatch.ts's own comment on why name-matching isn't used there
 * either), and that table has its own documented data-quality history, so
 * it's never treated as authoritative here.
 *
 * Returns null on no match OR any query error (logged, never thrown) — a
 * missing suggestion must never break login.
 */
export async function getSuggestedEmailByMobile(mobile: string): Promise<string | null> {
  const phone = normalizePhone(mobile);
  if (!phone) return null;

  try {
    const { data, error } = await supabaseAdmin
      .schema('registry')
      .from('registrants')
      .select('email')
      .eq('phone', phone)
      .not('email', 'is', null)
      .limit(1)
      .maybeSingle();

    if (error) {
      console.warn('getSuggestedEmailByMobile query error:', error);
      return null;
    }
    return (data as { email: string | null } | null)?.email ?? null;
  } catch (err) {
    console.warn('getSuggestedEmailByMobile unexpected error:', err);
    return null;
  }
}
