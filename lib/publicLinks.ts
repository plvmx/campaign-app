/**
 * Registry of public, no-login links — each one a page under /public/* backed
 * by a matching /api/public/* data route (see middleware.ts for why those
 * prefixes are unprotected). Single source of truth for:
 *  - the admin "Public Links" page (app/admin/public-links/page.tsx)
 *  - each public page's default title/description (used for both its own
 *    <title>/Open Graph metadata and the admin list), overridable per-link
 *    via app_settings — see publicLinkTitleSettingKey/publicLinkDescriptionSettingKey
 *    and lib/appSettings.ts's getSettingServer/setPublicLinkTitle/setPublicLinkDescription.
 *
 * Add an entry here whenever a new public page/link is built.
 */
export interface PublicLink {
  /**
   * Stable identifier for this link, used to build its app_settings keys
   * (publicLinkTitleSettingKey/publicLinkDescriptionSettingKey). Do not
   * rename an existing slug — any saved admin override would be orphaned
   * under the old key.
   */
  slug: string;
  /** Short, human-readable name shown as the entry's title (default — can be overridden per-link from /admin/public-links). */
  title: string;
  /** One-line description of what the link shows or collects (default — can be overridden per-link from /admin/public-links). */
  description: string;
  /** Path (from the site root) the link points to, e.g. '/public/week1-campaigns'. */
  path: string;
}

export const PUBLIC_LINKS: PublicLink[] = [
  {
    slug: 'week1-campaigns',
    title: 'Week 1 Campaigns',
    description: 'Always-current Week 1 Campaigns list, all states — no login required.',
    path: '/public/week1-campaigns',
  },
  {
    slug: 'temporary-upcoming-campaigns',
    title: 'Temporary Upcoming Campaigns',
    description: 'Check your upcoming campaign details for this fortnight — no login required.',
    path: '/public/temporary-upcoming-campaigns',
  },
];

/** app_settings key for a public link's title override. */
export function publicLinkTitleSettingKey(slug: string): string {
  return `public_link_title__${slug}`;
}

/** app_settings key for a public link's description override. */
export function publicLinkDescriptionSettingKey(slug: string): string {
  return `public_link_description__${slug}`;
}
