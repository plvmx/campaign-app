'use client';

import type { AriseCampaign } from '@/lib/ariseLayout';
import { getSlideStateColor, STATE_CODES, formatSlideDateText } from '@/lib/slideLayout';
import { formatCampaignTimeDisplay } from '@/lib/campaignUtils';
import { combinePlaceAndSite } from '@/lib/placeSite';

const PLACE_COLS  = 32;
const LEADER_COLS = 12;

interface Props {
  campaigns: AriseCampaign[];
  checkedIds: Set<string>;
  onToggle: (id: string) => void;
}

/**
 * Same colour key + campaign-line formatting as CampaignSlideView (the
 * "Future Campaigns" view) and PublicCampaignList (the read-only public
 * lists), but with a checkbox in front of each place — this list is for
 * registering interest. Takes AriseCampaign (the public-safe shape, no
 * mobile) rather than the full Campaign type, since this page is public.
 */
export default function CampaignCheckboxList({ campaigns, checkedIds, onToggle }: Props) {
  if (campaigns.length === 0) {
    return (
      <div className="p-4 text-center text-sm text-gray-500">
        No campaigns found
      </div>
    );
  }

  // Group by date (campaigns arrive pre-sorted by date/state/place/time)
  const grouped: Record<string, AriseCampaign[]> = {};
  const sortedDates: string[] = [];
  for (const c of campaigns) {
    if (!grouped[c.date]) {
      grouped[c.date] = [];
      sortedDates.push(c.date);
    }
    grouped[c.date].push(c);
  }

  return (
    // Force white background so slide state colours (incl. black for NSW) remain legible
    <div data-ti="components/registerInterest/CampaignCheckboxList.tsx" style={{ backgroundColor: '#ffffff' }}>

      {/* Colour key — sticky so it stays visible while the lines below it scroll */}
      <div
        className="sticky top-0 z-10 flex flex-wrap gap-x-3 gap-y-0.5 px-3 py-1.5 font-mono text-xs font-bold border-b border-gray-100"
        style={{ backgroundColor: '#ffffff' }}
      >
        <span style={{ color: 'rgb(130, 0, 0)' }}>Colour Key:</span>
        {STATE_CODES.map(s => (
          <span key={s} style={{ color: getSlideStateColor(s) }}>{s}</span>
        ))}
      </div>

      {/* Campaign rows grouped by date */}
      <div className="pb-2">
        {sortedDates.map(date => {
          const [y, m, d] = date.split('-').map(Number);
          const dateText = formatSlideDateText(new Date(y, m - 1, d));

          return (
            <div key={date} className="mt-1">
              {/* Yellow date header with dark-red italic text */}
              <div
                className="mx-3 px-2 py-0.5 inline-block text-sm font-bold italic"
                style={{ backgroundColor: '#ffff00', color: 'rgb(130, 0, 0)' }}
              >
                {dateText}
              </div>

              {/* One flex row per campaign — stretches to fill container width */}
              {grouped[date].map(c => {
                let place = combinePlaceAndSite(c.place, c.site);
                const cat = c.category ?? 'TWOL';
                if (cat !== 'TWOL') place = `${place} ${cat}`;
                if (place.length > PLACE_COLS) place = place.substring(0, PLACE_COLS);

                const time   = formatCampaignTimeDisplay(c.time);
                const leader = c.leader.length > LEADER_COLS
                  ? c.leader.substring(0, LEADER_COLS)
                  : c.leader;
                const color  = getSlideStateColor(c.state);
                const checked = checkedIds.has(c.id);

                return (
                  <label
                    key={c.id}
                    // A small grid rather than fixed flex columns: with larger text (the
                    // `large-text` scope) a one-line row no longer fits a phone and names were
                    // being cut off. On a phone the leader drops to a second line under the
                    // place; from `sm` up it is one line again.
                    className="grid grid-cols-[auto_1fr_auto] items-baseline gap-x-3 px-3 py-1 font-mono font-bold text-sm leading-snug cursor-pointer sm:grid-cols-[auto_1fr_auto_13ch]"
                    style={{ color, ...(cat !== 'TWOL' ? { backgroundColor: '#fcd34d' } : {}) }}
                  >
                    {/* Checkbox — centered on the row (both lines on a phone) */}
                    <span className="row-span-2 flex items-center self-center sm:row-span-1">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => onToggle(c.id)}
                        className="h-6 w-6 accent-blue-600"
                        aria-label={`Register interest in ${place}`}
                      />
                    </span>
                    {/* Place — left-aligned, takes the spare space */}
                    <span className="min-w-0 truncate">{place}</span>
                    {/* Time — right-aligned */}
                    <span className="whitespace-nowrap text-right">{time}</span>
                    {/* Leader — second line on a phone, own column from sm up */}
                    <span className="col-span-2 col-start-2 row-start-2 min-w-0 truncate sm:col-span-1 sm:col-start-4 sm:row-start-1">
                      {leader}
                    </span>
                  </label>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
