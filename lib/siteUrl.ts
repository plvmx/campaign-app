/**
 * Absolute site origin for use in <head> metadata (Open Graph/Twitter card
 * images and canonical URLs need absolute URLs to work when a page is
 * shared outside the app, e.g. in WhatsApp/iMessage link previews).
 *
 * Resolution order:
 *  0. `override`, if passed — lets a one-off script target a specific
 *     deployment (e.g. a Vercel preview URL for a branch not yet merged to
 *     main) without touching NEXT_PUBLIC_SITE_URL, which stays pointed at
 *     production. Not used by anything under app/ — only scripts/ callers
 *     that take an explicit site-url argument pass this.
 *  1. NEXT_PUBLIC_SITE_URL — set this explicitly if a custom domain is ever
 *     added and should be preferred over Vercel's own URL.
 *  2. VERCEL_PROJECT_PRODUCTION_URL — set automatically by Vercel to the
 *     project's production domain (custom domain if configured, otherwise
 *     the *.vercel.app one). Correct without any manual configuration.
 *  3. localhost fallback, for local dev.
 */
export function getSiteUrl(override?: string): string {
  if (override) return override;
  if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL;
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  return 'http://localhost:3000';
}
