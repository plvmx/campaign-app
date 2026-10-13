import { signOut } from '@/lib/auth';

/** Where a leader is sent to sign in (or first set up) with email + an authenticator code. */
export const REQUIRE_TWO_FACTOR_LOGIN_PATH = '/login?require2fa=1';

/**
 * Takes a leader who signed in with just mobile+name to the sign-in that asks
 * for two-factor authentication: they must set it up first if they haven't.
 * Signs the current session out first — /login would otherwise bounce a
 * signed-in leader straight back to /app — which is also right because the
 * session they come back with is a different (real, 2FA-verified) one.
 */
export async function startTwoFactorSignIn(): Promise<void> {
  await signOut();
  window.location.assign(REQUIRE_TWO_FACTOR_LOGIN_PATH);
}
