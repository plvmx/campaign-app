'use client';

import type { Campaign } from '@/lib/types';
import { getSlideStateColor, STATE_CODES, formatSlideDateText } from '@/lib/slideLayout';
import { formatCampaignTimeDisplay } from '@/lib/campaignUtils';
import { combinePlaceAndSite } from '@/lib/placeSite';

const PLACE_COLS  = 32;
const LEADER_COLS = 12;

interface Props {
  campaigns: Campaign[];
  checkedIds: Set<string>;
  onToggle: (id: string) => void;
}

/**
 * Same colour key + campaign-line formatting as CampaignSlideView (the
 * "Future Campaigns" view), but with a checkbox in front of each place and
 * the mobile number column dropped — this list is for registering interest,
 * not for contacting leaders directly.
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
  const grouped: Record<string, Campaign[]> = {};
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
    <div style={{ backgroundColor: '#ffffff' }}>

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
                    className="flex items-baseline px-3 py-px font-mono font-bold text-sm leading-snug cursor-pointer"
                    style={{ color, ...(cat !== 'TWOL' ? { backgroundColor: '#fcd34d' } : {}) }}
                  >
                    {/* Checkbox — alignSelf overrides the row's items-baseline so it
                        sits centered on the line text instead of on its baseline */}
                    <span style={{ flex: 2, display: 'flex', alignItems: 'center', alignSelf: 'center' }}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => onToggle(c.id)}
                        className="h-4 w-4 accent-blue-600"
                        aria-label={`Register interest in ${place}`}
                      />
                    </span>
                    {/* Place — left-aligned, grows to fill spare space */}
                    <span style={{ flex: 30, minWidth: 0, paddingLeft: '1.5ch', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {place}
                    </span>
                    {/* Time — right-aligned within its column */}
                    <span style={{ flex: 9, textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {time}
                    </span>
                    {/* Leader */}
                    <span style={{ flex: 13, paddingLeft: '0.75ch', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
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
