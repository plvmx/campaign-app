'use client';

import type { Campaign } from '@/lib/types';
import { getSlideStateColor, STATE_CODES, formatSlideDateText } from '@/lib/slideLayout';
import { formatCampaignTimeDisplay } from '@/lib/campaignUtils';

const PLACE_COLS  = 18;
const TIME_COLS   = 9;
const LEADER_COLS = 12;

interface Props {
  campaigns: Campaign[];
}

export default function CampaignSlideView({ campaigns }: Props) {
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

      {/* Red title banner — mirrors the JPEG slide header */}
      <div
        className="py-2 text-center font-bold text-white text-sm tracking-wide"
        style={{ backgroundColor: 'rgb(255, 0, 0)' }}
      >
        A.F.J UPCOMING CAMPAIGNS
      </div>

      {/* Colour key */}
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 px-3 py-1.5 font-mono text-xs font-bold">
        <span style={{ color: 'rgb(130, 0, 0)' }}>Colour Key:</span>
        {STATE_CODES.map(s => (
          <span key={s} style={{ color: getSlideStateColor(s) }}>{s}</span>
        ))}
      </div>

      {/* Campaign rows grouped by date */}
      <div className="overflow-x-auto">
        <div className="min-w-[480px] font-mono font-bold text-sm pb-2">
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

                {/* One line per campaign */}
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

                  const line = `${place.padEnd(PLACE_COLS)} ${time.padStart(TIME_COLS)} ${leader.padEnd(LEADER_COLS)} ${mobile}`;

                  return (
                    <div
                      key={c.id}
                      className="px-3 py-px whitespace-pre leading-snug"
                      style={{ color: getSlideStateColor(c.state) }}
                    >
                      {line}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
