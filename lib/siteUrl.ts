/**
 * Absolute site origin for use in <head> metadata (Open Graph/Twitter card
 * images and canonical URLs need absolute URLs to work when a page is
 * shared outside the app, e.g. in WhatsApp/iMessage link previews).
 *
 * Resolution order:
 *  1. NEXT_PUBLIC_SITE_URL — set this explicitly if a custom domain is ever
 *     added and should be preferred over Vercel's own URL.
 *  2. VERCEL_PROJECT_PRODUCTION_URL — set automatically by Vercel to the
 *     project's production domain (custom domain if configured, otherwise
 *     the *.vercel.app one). Correct without any manual configuration.
 *  3. localhost fallback, for local dev.
 */
export function getSiteUrl(): string {
  if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL;
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  return 'http://localhost:3000';
}
