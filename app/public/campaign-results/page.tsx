import type { Metadata } from 'next';
import CampaignResultsClient from './CampaignResultsClient';
import { PUBLIC_LINKS, PUBLIC_LINK_OG_IMAGE, publicLinkTitleSettingKey, publicLinkDescriptionSettingKey } from '@/lib/publicLinks';
import { getSettingServer } from '@/lib/appSettings';

const LINK = PUBLIC_LINKS.find((l) => l.slug === 'campaign-results')!;

// See app/public/week1-campaigns/page.tsx for why this is force-dynamic
// (an admin's title/description override should take effect immediately,
// not just on the next deploy).
export const dynamic = 'force-dynamic';

// A Server Component (no 'use client') so it can export `metadata` — see
// app/public/week1-campaigns/page.tsx for the full rationale.
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

export default function CampaignResultsPage() {
  return <CampaignResultsClient />;
}
