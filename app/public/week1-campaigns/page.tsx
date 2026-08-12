import type { Metadata } from 'next';
import Week1CampaignsClient from './Week1CampaignsClient';

const TITLE = 'Week 1 Campaigns';
const DESCRIPTION = 'Always-current Week 1 Campaigns list, all states — no login required.';

// A Server Component (no 'use client') so it can export `metadata` — link
// previews (WhatsApp, iMessage, etc.) read these Open Graph/Twitter tags to
// build a rich preview card. Without them, some clients show a bare
// "Copy link / Open link" prompt instead of navigating straight through.
export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  // No `images` — text-only preview card (title + description + link), no
  // thumbnail, per request after seeing the branded icon in a WhatsApp preview.
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: '/public/week1-campaigns',
    type: 'website',
  },
  twitter: {
    card: 'summary',
    title: TITLE,
    description: DESCRIPTION,
  },
};

export default function Week1CampaignsPage() {
  return <Week1CampaignsClient />;
}
