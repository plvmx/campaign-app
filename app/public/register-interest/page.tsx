import type { Metadata } from 'next';
import RegisterInterestClient from './RegisterInterestClient';
import { PUBLIC_LINKS, publicLinkTitleSettingKey, publicLinkDescriptionSettingKey } from '@/lib/publicLinks';
import { getSettingServer } from '@/lib/appSettings';

const LINK = PUBLIC_LINKS.find((l) => l.slug === 'register-interest')!;

// Without this, Next.js prerenders the page (and runs generateMetadata) once
// at build time and bakes the result into static HTML — an admin's title/
// description edit on /admin/public-links would then only take effect on
// the next deploy, not immediately. Forces per-request rendering instead.
export const dynamic = 'force-dynamic';

// A Server Component (no 'use client') so it can export `metadata` — link
// previews (WhatsApp, iMessage, etc.) read these Open Graph/Twitter tags to
// build a rich preview card. Without them, some clients show a bare
// "Copy link / Open link" prompt instead of navigating straight through.
//
// Dynamic (generateMetadata, not a static `export const metadata`) so an
// admin's title/description override from /admin/public-links — saved to
// app_settings — takes effect without a redeploy. Falls back to the code
// default in lib/publicLinks.ts when no override is set.
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
      images: ['/icons/icon-512x512.png'],
    },
    twitter: {
      card: 'summary',
      title,
      description,
      images: ['/icons/icon-512x512.png'],
    },
  };
}

export default function RegisterInterestPage() {
  return <RegisterInterestClient />;
}
