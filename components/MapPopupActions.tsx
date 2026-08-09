'use client';

/**
 * Stub RSVP actions shown under a map popup's Leader line (Campaign Map,
 * Campaigns Near Me — not the state places map, which has no campaign to
 * act on). Not wired to any backend yet.
 *
 * TODO: replace the console.log placeholders with real actions — e.g.
 * recording an RSVP against `campaignId` and opening a campaign details
 * view — once that behaviour is designed.
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
