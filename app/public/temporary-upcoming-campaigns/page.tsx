import type { Metadata } from 'next';
import TemporaryUpcomingCampaignsClient from './TemporaryUpcomingCampaignsClient';

const TITLE = 'Temporary Upcoming Campaigns';
const DESCRIPTION = 'Check your upcoming campaign details for this fortnight — no login required.';

// A Server Component (no 'use client') so it can export `metadata` — link
// previews (WhatsApp, iMessage, etc.) read these Open Graph/Twitter tags to
// build a rich preview card. Without them, some clients show a bare
// "Copy link / Open link" prompt instead of navigating straight through.
export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: '/public/temporary-upcoming-campaigns',
    type: 'website',
    images: ['/icons/icon-512x512.png'],
  },
  twitter: {
    card: 'summary',
    title: TITLE,
    description: DESCRIPTION,
    images: ['/icons/icon-512x512.png'],
  },
};

export default function TemporaryUpcomingCampaignsPage() {
  return <TemporaryUpcomingCampaignsClient />;
}
