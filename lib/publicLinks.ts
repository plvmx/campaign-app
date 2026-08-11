/**
 * Registry of public, no-login links — each one a page under /public/* backed
 * by a matching /api/public/* data route (see middleware.ts for why those
 * prefixes are unprotected). Single source of truth for the admin "Public
 * Links" page (app/admin/public-links/page.tsx); add an entry here whenever
 * a new public page/link is built.
 */
export interface PublicLink {
  /** Short, human-readable name shown as the entry's title. */
  title: string;
  /** One-line description of what the link shows or collects. */
  description: string;
  /** Path (from the site root) the link points to, e.g. '/public/week1-campaigns'. */
  path: string;
}

export const PUBLIC_LINKS: PublicLink[] = [
  {
    title: 'Week 1 Campaigns',
    description: 'Always-current Week 1 Campaigns list (all states) as a viewable/downloadable JPEG — no login required.',
    path: '/public/week1-campaigns',
  },
];
