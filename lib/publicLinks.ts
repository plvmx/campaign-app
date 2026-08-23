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

/**
 * Open Graph image for public-link preview cards. Deliberately the *small*
 * 192x192 app icon, with explicit width/height, rather than the 512x512
 * icon used for the PWA manifest: WhatsApp's link-preview crawler fetches
 * og:image and — for a large, undeclared image — renders a big banner-style
 * card that can fill two-thirds of a phone screen. A small, explicitly-sized
 * image keeps it as a compact thumbnail beside the title/description.
 */
export const PUBLIC_LINK_OG_IMAGE = {
  url: '/icons/icon-192x192.png',
  width: 192,
  height: 192,
  alt: 'AFJ Campaign App',
};

export const PUBLIC_LINKS: PublicLink[] = [
  {
    slug: 'week1-campaigns',
    title: 'Week 1 Campaigns',
    description: 'Always-current Week 1 Campaigns list, all states — no login required.',
    path: '/public/week1-campaigns',
  },
  {
    slug: 'temporary-upcoming-campaigns',
    title: 'Temporary AFJ Campaign Lists',
    description: 'Check your upcoming campaign details for this fortnight — no login required.',
    path: '/public/temporary-upcoming-campaigns',
  },
  {
    slug: 'final-campaign-lists',
    title: 'Final AFJ Campaign Lists',
    description: 'Here are the final campaign lists for this fortnight',
    path: '/public/final-campaign-lists',
  },
  {
    slug: 'campaign-results',
    title: 'Campaign Results',
    description: 'Latest campaign results, all states — no login required.',
    path: '/public/campaign-results',
  },
  {
    slug: 'register-interest',
    title: 'Register Interest',
    description: "Tick the campaigns you'd like to join or find out more about, then let us know — no login required.",
    path: '/public/register-interest',
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
