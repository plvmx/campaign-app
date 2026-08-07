'use client';

import { AUSTRALIAN_STATES } from '@/lib/constants';
import { getSlideStateColor } from '@/lib/slideLayout';

/**
 * Compact colour key mapping each state to its map pin colour (see
 * lib/leafletMarkerIcon.ts, which draws pins from the same SLIDE_STATE_COLORS
 * palette). Shown above every map that uses state-coloured pins — Campaign Map,
 * Campaigns Near Me, State Places Map — so the colouring is legible without
 * opening each marker's popup.
 */
export default function MapStateLegend() {
  return (
    <div className="mb-3 flex flex-wrap gap-x-3 gap-y-1.5 rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-xs dark:border-gray-700 dark:bg-gray-800/50">
      {AUSTRALIAN_STATES.map(state => (
        <span key={state} className="flex items-center gap-1.5 text-gray-700 dark:text-gray-300">
          <span
            className="inline-block h-3 w-3 shrink-0 rounded-full border border-gray-800/40 dark:border-gray-100/40"
            style={{ backgroundColor: getSlideStateColor(state) }}
            aria-hidden="true"
          />
          {state}
        </span>
      ))}
    </div>
  );
}
