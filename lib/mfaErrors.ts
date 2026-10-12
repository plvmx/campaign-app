/**
 * Plain-language text for a failed authenticator-code check. Supabase's own
 * messages ("Invalid TOTP code entered") tell a non-technical leader nothing
 * about what to try; the usual causes are all on the phone side — a stale
 * entry from an earlier setup attempt (each attempt makes a new secret but
 * the same-looking label), a phone clock that has drifted (codes are only
 * valid for ~30–60 seconds either side of the server's clock), or a code
 * that expired before it was typed.
 */
export function describeMfaVerifyError(error: { message: string; code?: string | null }): string {
  const code = error.code ?? '';
  const message = error.message.toLowerCase();

  if (code === 'mfa_verification_failed' || message.includes('invalid totp')) {
    return (
      "That code didn't work. Please check: (1) you are reading the newest \"AFJ Campaign App\" entry in your authenticator app — " +
      'delete any older AFJ entries, as only the one from this page works; (2) your phone\'s date and time are set to "automatic"; ' +
      '(3) type the code before it changes. Then try again.'
    );
  }
  if (code === 'mfa_challenge_expired' || message.includes('challenge has expired')) {
    return 'That took too long. Please try again with the code now showing in your app.';
  }
  if (code === 'over_request_rate_limit' || message.includes('rate limit') || message.includes('too many')) {
    return 'Too many attempts. Please wait a minute, then try again.';
  }
  if (code === 'mfa_factor_not_found' || message.includes('factor not found')) {
    return 'This setup has expired. Please go back to the sign-in page and start setup again.';
  }
  return error.message;
}
