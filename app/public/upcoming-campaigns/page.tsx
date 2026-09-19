import type { Metadata } from 'next';
import UpcomingCampaignsClient from './UpcomingCampaignsClient';
import { PUBLIC_LINKS, PUBLIC_LINK_OG_IMAGE, publicLinkTitleSettingKey, publicLinkDescriptionSettingKey } from '@/lib/publicLinks';
import { getSettingServer } from '@/lib/appSettings';

const LINK = PUBLIC_LINKS.find((l) => l.slug === 'upcoming-campaigns')!;

// Without this, Next.js prerenders the page (and runs generateMetadata) once
// at build time and bakes the result into static HTML — an admin's title/
// description edit on /admin/public-links would then only take effect on
// the next deploy, not immediately. Forces per-request rendering instead.
export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const [titleOverride, descriptionOverride] = await Promise.all([
    getSettingServer(publicLinkTitleSettingKey(LINK.slug)),
    getSettingServer(publicLinkDescriptionSettingKey(LINK.slug)),
  ]);
  const title = titleOverride || LINK.title;
  const description = descriptionOverride || LINK.description;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      url: LINK.path,
      type: 'website',
      siteName: 'AFJ Campaign App',
      images: [PUBLIC_LINK_OG_IMAGE],
    },
    twitter: {
      card: 'summary',
      title,
      description,
      images: [PUBLIC_LINK_OG_IMAGE.url],
    },
  };
}

export default function UpcomingCampaignsPage() {
  return <UpcomingCampaignsClient />;
}
