import type { Metadata } from 'next';
import DonateClient from '@/components/donate/DonateClient';
import { PUBLIC_LINKS, PUBLIC_LINK_OG_IMAGE, publicLinkTitleSettingKey, publicLinkDescriptionSettingKey } from '@/lib/publicLinks';
import { getSettingServer } from '@/lib/appSettings';

const LINK = PUBLIC_LINKS.find((l) => l.slug === 'donate')!;

// See app/public/register-interest/page.tsx for why this is force-dynamic
// (an admin's title/description override must take effect without a redeploy).
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
      siteName: 'TWOL Campaign Activity System',
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

export default function DonatePage() {
  return <DonateClient />;
}
