/**
 * Scanner-proof magic links. Supabase's own `{{ .ConfirmationURL }}` is a
 * `/verify` URL that is consumed by *any* GET — so a mail program that opens
 * links before the person does (Apple Mail Privacy Protection, Outlook /
 * Microsoft link checkers; confirmed repeatedly in this app) uses the link up,
 * and the person lands on an "expired" page. Instead the Magic Link email
 * template links straight to one of our landing pages with the token in the
 * query string (`{{ .RedirectTo }}&token_hash={{ .TokenHash }}&type=email`),
 * and the page only calls verifyOtp() when the person *taps a button* — a
 * scanner that merely fetches the page never does.
 *
 * `{{ .RedirectTo }}` is the `emailRedirectTo` each sender passes, so every
 * such URL must already contain a `?` for the `&token_hash=` to attach to
 * (propose-email has `?leaderId=`; the others carry `?via=email`).
 */
export const MAGIC_LINK_TOKEN_PARAM = 'token_hash';

// Supabase token hashes are short; bound the input before it goes anywhere.
const MAX_TOKEN_HASH_LENGTH = 200;

/** The one-time token hash from a magic-link landing URL's query string, if any. */
export function readTokenHashFromUrl(search: string = typeof window === 'undefined' ? '' : window.location.search): string | null {
  const value = new URLSearchParams(search).get(MAGIC_LINK_TOKEN_PARAM);
  if (!value || value.length > MAX_TOKEN_HASH_LENGTH) return null;
  return value;
}

/** Removes the token from the address bar so a refresh/bookmark/history entry can't replay it. */
export function stripTokenHashFromUrl(): void {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  if (!url.searchParams.has(MAGIC_LINK_TOKEN_PARAM)) return;
  url.searchParams.delete(MAGIC_LINK_TOKEN_PARAM);
  url.searchParams.delete('type');
  window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
}
