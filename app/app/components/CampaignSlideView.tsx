'use client';

import type { Campaign } from '@/lib/types';
import { getSlideStateColor, STATE_CODES, formatSlideDateText } from '@/lib/slideLayout';
import { formatCampaignTimeDisplay } from '@/lib/campaignUtils';

const PLACE_COLS  = 18;
const LEADER_COLS = 12;

interface Props {
  campaigns: Campaign[];
  adminStatus: string | null;
}

export default function CampaignSlideView({ campaigns, adminStatus }: Props) {
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

      {/* Colour key — admin only */}
      {adminStatus === 'AD' && (
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 px-3 py-1.5 font-mono text-xs font-bold border-b border-gray-100">
          <span style={{ color: 'rgb(130, 0, 0)' }}>Colour Key:</span>
          {STATE_CODES.map(s => (
            <span key={s} style={{ color: getSlideStateColor(s) }}>{s}</span>
          ))}
        </div>
      )}

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
                let place = c.place;
                const cat = c.category ?? 'TWOL';
                if (cat !== 'TWOL') place = `${place} ${cat}`;
                if (place.length > PLACE_COLS) place = place.substring(0, PLACE_COLS);

                const time   = formatCampaignTimeDisplay(c.time);
                const leader = c.leader.length > LEADER_COLS
                  ? c.leader.substring(0, LEADER_COLS)
                  : c.leader;
                const mobile = (c.mobile ?? '').replace(/\s/g, '');
                const color  = getSlideStateColor(c.state);

                return (
                  <div
                    key={c.id}
                    className="flex items-baseline px-3 py-px font-mono font-bold text-sm leading-snug"
                    style={{ color, ...(cat !== 'TWOL' ? { backgroundColor: '#fcd34d' } : {}) }}
                  >
                    {/* Place — left-aligned, grows to fill spare space */}
                    <span style={{ flex: 18, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
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
                    {/* Mobile */}
                    <span style={{ flex: 10, paddingLeft: '0.75ch', whiteSpace: 'nowrap' }}>
                      {mobile}
                    </span>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
