'use client';
import { AUSTRALIAN_STATES } from '@/lib/constants';

interface Props {
  filterState: string;
  filterPlace: string;
  filterLeader: string;
  filterMobile: string;
  placeOptions: string[];
  leaderOptions: string[];
  mobileOptions: string[];
  onChange: (field: 'state' | 'place' | 'leader' | 'mobile', value: string) => void;
  onClear: () => void;
}

const selectClass =
  'block w-full rounded-md border-2 border-gray-400 bg-white px-2 py-1.5 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500 dark:border-gray-500 dark:bg-gray-900 dark:text-white';

export default function CampaignFilters({
  filterState, filterPlace, filterLeader, filterMobile,
  placeOptions, leaderOptions, mobileOptions,
  onChange, onClear,
}: Props) {
  const hasFilters = filterState || filterPlace || filterLeader || filterMobile;

  return (
    <div className="w-full space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label htmlFor="filter-state" className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">State</label>
          <select id="filter-state" value={filterState} onChange={(e) => onChange('state', e.target.value)} className={selectClass}>
            <option value="">All States</option>
            {AUSTRALIAN_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="filter-place" className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Place</label>
          <select id="filter-place" value={filterPlace} onChange={(e) => onChange('place', e.target.value)} className={selectClass}>
            <option value="">All Places</option>
            {placeOptions.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="filter-leader" className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Leader</label>
          <select id="filter-leader" value={filterLeader} onChange={(e) => onChange('leader', e.target.value)} className={selectClass}>
            <option value="">All Leaders</option>
            {leaderOptions.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="filter-mobile" className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Mobile</label>
          <select id="filter-mobile" value={filterMobile} onChange={(e) => onChange('mobile', e.target.value)} className={selectClass}>
            <option value="">All Mobiles</option>
            {mobileOptions.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
      </div>
      {hasFilters && (
        <button onClick={onClear} className="text-xs text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300">
          ✕ Clear filters
        </button>
      )}
    </div>
  );
}
