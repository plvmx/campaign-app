import type { Metadata } from 'next';
import TrainingInterestClient from './TrainingInterestClient';
import { loadTrainingCampaign } from '@/app/api/public/training-interest/[campaignId]/route';
import { combinePlaceAndSite } from '@/lib/placeSite';

// Per-campaign page, so — unlike the static entries in lib/publicLinks.ts —
// title/description are computed from the campaign record rather than a
// fixed default. Forces per-request rendering so a just-created campaign's
// link works immediately rather than needing a redeploy.
export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ campaignId: string }> }): Promise<Metadata> {
  const { campaignId } = await params;
  // Reuses the API route's own campaign lookup (loadTrainingCampaign) rather
  // than duplicating the query here — one query, one place to fix the
  // BOTJ/TLT gate. A lookup failure falls back to generic metadata rather
  // than failing the whole page render; logged so it isn't silently invisible.
  const campaign = await loadTrainingCampaign(campaignId).catch((err) => {
    console.error('training-interest generateMetadata: failed to load campaign:', err);
    return null;
  });

  const title = campaign
    ? `${campaign.category} Training — ${combinePlaceAndSite(campaign.place, campaign.site)}, ${campaign.state}`
    : 'Training Session';
  const description = campaign
    ? `Register your interest in this ${campaign.category} training session led by ${campaign.leader}.`
    : 'Register your interest in this training session.';

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      url: `/public/training/${campaignId}`,
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

export default async function TrainingInterestPage({ params }: { params: Promise<{ campaignId: string }> }) {
  const { campaignId } = await params;
  return <TrainingInterestClient campaignId={campaignId} />;
}
