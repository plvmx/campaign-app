/**
 * Centralized error handling utilities
 */

/**
 * Safely extract a user-facing error message from an unknown error.
 *
 * Handles three shapes that all occur in practice:
 *   1. Native Error instances — return .message
 *   2. Plain strings — return as-is
 *   3. PostgrestError / Supabase-thrown errors — plain objects with .message,
 *      .code, .details, .hint. These do NOT pass `instanceof Error`, so
 *      without explicit handling the fallback ("An unexpected error occurred")
 *      was being returned for every Supabase error, hiding the real cause.
 */
export function getErrorMessage(err: unknown, fallback = 'An unexpected error occurred'): string {
  if (err instanceof Error) {
    return err.message;
  }
  if (typeof err === 'string') {
    return err;
  }
  if (err && typeof err === 'object') {
    const e = err as { message?: unknown; code?: unknown; details?: unknown; hint?: unknown };
    const parts: string[] = [];
    if (typeof e.message === 'string' && e.message) parts.push(e.message);
    if (typeof e.code    === 'string' && e.code)    parts.push(`code: ${e.code}`);
    if (typeof e.details === 'string' && e.details) parts.push(`details: ${e.details}`);
    if (typeof e.hint    === 'string' && e.hint)    parts.push(`hint: ${e.hint}`);
    if (parts.length) return parts.join(' | ');
  }
  return fallback;
}
