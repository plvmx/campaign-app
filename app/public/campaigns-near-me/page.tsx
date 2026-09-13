import type { Metadata } from 'next';
import { Suspense } from 'react';
import CampaignsNearMeClient from './CampaignsNearMeClient';

// Personalized per-registrant (?r=<id>), same reasoning
// /public/training/[campaignId] gives for staying out of lib/publicLinks.ts:
// that registry is for the fixed, enumerable links listed on
// /admin/public-links, not a one-per-recipient link. Generic static
// metadata, since there's no per-recipient title/description worth
// computing (unlike /public/training/[campaignId], which names the actual
// campaign).
export const metadata: Metadata = {
  title: 'Campaigns Near You — AFJ',
  description: 'See upcoming AFJ campaigns near you and register your interest.',
};

export default function CampaignsNearMePage() {
  // useSearchParams() (for ?r=<registrantId>) requires a Suspense boundary
  // to avoid opting the whole page out of static rendering — same pattern
  // app/campaign-interest/page.tsx and others already use.
  return (
    <Suspense fallback={<div className="p-4 text-sm text-gray-600">Loading…</div>}>
      <CampaignsNearMeClient />
    </Suspense>
  );
}
