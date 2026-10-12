import { supabase } from '@/lib/supabaseClient';
import type {
  ContactLookupInput,
  ContactLookupResult,
  RegistrationCheckInput,
  RegistrationCheckResult,
} from './registrationCheckService';

/**
 * Browser-side calls to the two registration-check APIs (the leader screen
 * at /app/check-registration and the admin one at /admin/check-registration).
 * They go through the API (service role) rather
 * than a direct query because a leader's own session has no access to the
 * registry schema — see registrationCheckService.ts for what is and isn't
 * returned. Kept apart from that module so the API route doesn't pull the
 * browser Supabase client into its bundle.
 */
async function postCheck<T>(path: string, input: unknown): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('You are not signed in. Please sign in and try again.');

  const response = await fetch(path, {
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
  return body as T;
}

export function requestRegistrationCheck(input: RegistrationCheckInput): Promise<RegistrationCheckResult> {
  return postCheck('/api/leader/check-registration', input);
}

/** The admin (AD + 2FA) contact-only lookup — POST /api/admin/check-registration. */
export function requestAdminRegistrationLookup(input: ContactLookupInput): Promise<ContactLookupResult> {
  return postCheck('/api/admin/check-registration', input);
}
