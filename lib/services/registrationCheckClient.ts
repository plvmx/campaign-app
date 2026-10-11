import { supabase } from '@/lib/supabaseClient';
import type { RegistrationCheckInput, RegistrationCheckResult } from './registrationCheckService';

/**
 * Browser-side call to POST /api/leader/check-registration for the
 * /app/check-registration screen. Goes through the API (service role) rather
 * than a direct query because a leader's own session has no access to the
 * registry schema — see registrationCheckService.ts for what is and isn't
 * returned. Kept apart from that module so the API route doesn't pull the
 * browser Supabase client into its bundle.
 */
export async function requestRegistrationCheck(input: RegistrationCheckInput): Promise<RegistrationCheckResult> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('You are not signed in. Please sign in and try again.');

  const response = await fetch('/api/leader/check-registration', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify(input),
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.error || `The check could not be completed (${response.status}).`);
  }
  return body as RegistrationCheckResult;
}
