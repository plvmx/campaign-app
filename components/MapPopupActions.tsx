'use client';

/**
 * Stub RSVP actions shown under a map popup's Leader line on the ADMIN
 * Campaign Map / Campaigns Near Me screens (not the state places map,
 * which has no campaign to act on). Still not wired to any backend for an
 * admin viewing this map — deliberately out of scope when the equivalent
 * was built for the public, registrant-facing map instead (below).
 *
 * TODO: replace the console.log placeholders with real actions — e.g.
 * recording an RSVP against `campaignId` and opening a campaign details
 * view — once that behaviour is designed for an admin's own use of this
 * map. See components/PublicCampaignInterestActions.tsx for a real,
 * working equivalent (registers interest into campaign_interest via
 * /api/public/campaigns-near-me) built for app/public/campaigns-near-me
 * instead — NearbyCampaignsMap.tsx's `renderActions` prop is what lets
 * each screen swap this component out for its own.
 */
interface MapPopupActionsProps {
  campaignId: string;
  place: string;
  state: string;
}

export default function MapPopupActions({ campaignId, place, state }: MapPopupActionsProps) {
  return (
    <div className="mt-2 flex gap-2">
      <button
        type="button"
        onClick={() => console.log(`"Yes I'm In" clicked — campaign ${campaignId} at ${place}, ${state}`)}
        className="rounded-md border border-gray-800 bg-green-600 px-2 py-1 text-xs font-bold text-white hover:bg-green-700"
      >
        Yes I&apos;m In
      </button>
      <button
        type="button"
        onClick={() => console.log(`"Tell Me More" clicked — campaign ${campaignId} at ${place}, ${state}`)}
        className="rounded-md border border-gray-800 bg-orange-500 px-2 py-1 text-xs font-bold text-white hover:bg-orange-600"
      >
        Tell Me More
      </button>
    </div>
  );
}
