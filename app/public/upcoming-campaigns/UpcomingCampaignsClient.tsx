'use client';

/**
 * Public "Upcoming Campaigns" map (/public/upcoming-campaigns) — the
 * general-public replacement for the admin-only "View Campaign Map"
 * screen (formerly /admin/campaign-map, removed from the Admin console's
 * "In Development" section once this shipped). Backed by
 * app/api/public/upcoming-campaigns/route.ts for markers and
 * app/api/public/geocode-postcode/route.ts for the postcode-based
 * "Near Me" recentre — no browser geolocation prompt, since an anonymous
 * visitor types their own postcode instead.
 */
import { useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { useCampaignDates } from '@/contexts/CampaignDatesContext';
import { AUSTRALIA_MAP_CENTER } from '@/lib/constants';
import { formatDateForDb, formatWeekDateRangeString } from '@/lib/campaignDates';
import { getErrorMessage } from '@/lib/errorUtils';
import type { UpcomingCampaignsResponse } from '@/app/api/public/upcoming-campaigns/route';
import PublicMapRegisterInterestActions from '@/components/PublicMapRegisterInterestActions';

/** Approximate zoom level for a ~60km-radius view around a postcode. */
const POSTCODE_ZOOM = 10;

const CampaignMap = dynamic(() => import('@/components/CampaignMap'), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center text-sm text-gray-500">Loading map…</div>
  ),
});

export default function UpcomingCampaignsClient() {
  const { dates: campaignDates } = useCampaignDates();

  // Week 1 is the upcoming campaign week; Week 2 is the one after it.
  const [selectedWeek, setSelectedWeek] = useState<1 | 2>(1);

  const weeks = useMemo(() => {
    if (!campaignDates) return null;
    const week1Start = campaignDates.upcomingCampaignStart;
    const week2Start = campaignDates.secondWeekStart;
    return {
      1: { startDate: formatDateForDb(week1Start), rangeText: formatWeekDateRangeString(week1Start) },
      2: { startDate: formatDateForDb(week2Start), rangeText: formatWeekDateRangeString(week2Start) },
    };
  }, [campaignDates]);

  const { startDate, endDate } = useMemo(() => {
    if (!weeks) return { startDate: '', endDate: '' };
    const start = weeks[selectedWeek].startDate;
    const [y, m, d] = start.split('-').map(Number);
    const end = new Date(y, m - 1, d + 6);
    return { startDate: start, endDate: formatDateForDb(end) };
  }, [weeks, selectedWeek]);

  const [markers, setMarkers] = useState<UpcomingCampaignsResponse['markers']>([]);
  const [unresolvedCount, setUnresolvedCount] = useState(0);
  const [isLoadingMap, setIsLoadingMap] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);

  useEffect(() => {
    if (!startDate || !endDate) return;

    let cancelled = false;

    Promise.resolve()
      .then(() => {
        setIsLoadingMap(true);
        setMapError(null);
        return fetch(`/api/public/upcoming-campaigns?startDate=${startDate}&endDate=${endDate}`);
      })
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? 'Failed to load campaigns for the map');
        return json as UpcomingCampaignsResponse;
      })
      .then((result) => {
        if (cancelled) return;
        setMarkers(result.markers);
        setUnresolvedCount(result.unresolvedCount);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setMapError(getErrorMessage(err, 'Failed to load campaigns for the map'));
      })
      .finally(() => {
        if (!cancelled) setIsLoadingMap(false);
      });

    return () => { cancelled = true; };
  }, [startDate, endDate]);

  // Postcode "Near Me" — recentres the map on the postcode's coordinates.
  // Does not re-filter the marker set, same as the admin map's own
  // geolocation-based "Near Me" behaviour it replaces.
  const [postcode, setPostcode] = useState('');
  const [isLocating, setIsLocating] = useState(false);
  const [postcodeError, setPostcodeError] = useState<string | null>(null);
  const [nearMeTarget, setNearMeTarget] = useState<{ center: [number, number]; zoom: number } | null>(null);

  const handlePostcodeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = postcode.trim();
    if (!trimmed) return;

    setIsLocating(true);
    setPostcodeError(null);
    try {
      const res = await fetch('/api/public/geocode-postcode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ postcode: trimmed }),
      });
      const json = await res.json();
      if (!res.ok) {
        setPostcodeError(json.error ?? 'Could not look up that postcode.');
        return;
      }
      setNearMeTarget({ center: [json.latitude, json.longitude], zoom: POSTCODE_ZOOM });
    } catch (err: unknown) {
      setPostcodeError(getErrorMessage(err, 'Could not look up that postcode.'));
    } finally {
      setIsLocating(false);
    }
  };

  const { center, zoom } = nearMeTarget ?? { center: [AUSTRALIA_MAP_CENTER.lat, AUSTRALIA_MAP_CENTER.lng] as [number, number], zoom: AUSTRALIA_MAP_CENTER.zoom };

  return (
    <div className="mx-auto flex h-[100dvh] max-w-4xl flex-col p-4">
      <div className="mb-3">
        <h1 className="text-2xl font-bold text-gray-900">Upcoming AFJ Campaigns</h1>
        <p className="mt-1 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm font-medium text-blue-800">
          Click on a colored circle for Details or to Register your Interest.
        </p>
      </div>

      {weeks && (
        <div className="mb-3 flex gap-2">
          {([1, 2] as const).map(week => (
            <button
              key={week}
              type="button"
              onClick={() => setSelectedWeek(week)}
              className={`flex-1 rounded-md px-3 py-2 text-sm font-semibold border-2 transition-colors ${
                selectedWeek === week
                  ? 'bg-blue-600 text-white border-blue-700'
                  : 'bg-white text-gray-700 border-gray-400 hover:bg-gray-50'
              }`}
            >
              {week === 1 ? 'This Week' : 'Next Week'}
            </button>
          ))}
        </div>
      )}

      {mapError && (
        <div className="mb-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {mapError}
        </div>
      )}

      {!mapError && unresolvedCount > 0 && (
        <div className="mb-3 rounded-lg border border-yellow-200 bg-yellow-50 p-3 text-sm text-yellow-800">
          {unresolvedCount} place{unresolvedCount === 1 ? '' : 's'} could not be located on the map.
        </div>
      )}

      <div className="relative flex-1 overflow-hidden rounded-lg border-2 border-gray-800">
        <div className="absolute top-2 right-2 z-[1000] w-fit max-w-[calc(100%-1rem)] rounded-md border-2 border-gray-800 bg-white px-3 py-2 shadow">
          <form onSubmit={handlePostcodeSubmit} className="flex flex-nowrap items-center justify-center gap-2 overflow-x-auto">
            <label className="whitespace-nowrap text-xs text-gray-700">
              Show me Campaigns <strong className="font-bold">Near Me</strong> - my Postcode is
            </label>
            <input
              type="text"
              inputMode="numeric"
              maxLength={4}
              value={postcode}
              onChange={(e) => setPostcode(e.target.value.replace(/\D/g, ''))}
              placeholder="3000"
              className="w-16 shrink-0 rounded-md border border-gray-300 px-1.5 py-1 text-xs font-normal text-gray-900"
            />
            <button
              type="submit"
              disabled={isLocating || postcode.trim().length !== 4}
              className="shrink-0 rounded-md bg-blue-600 px-2 py-1 text-xs font-bold text-white hover:bg-blue-700 disabled:bg-gray-400"
            >
              {isLocating ? '…' : 'Go'}
            </button>
          </form>
          {postcodeError && (
            <p className="mt-1 text-center text-xs font-normal text-red-700">{postcodeError}</p>
          )}
        </div>
        {isLoadingMap && (
          <div className="absolute inset-0 z-[1100] flex flex-col items-center justify-center gap-3 bg-white/80 px-6 text-center">
            <p className="text-sm text-gray-700">Please wait — locating campaigns on the map</p>
          </div>
        )}
        <CampaignMap
          center={center}
          zoom={zoom}
          markers={markers}
          renderActions={({ campaignId }) => <PublicMapRegisterInterestActions campaignId={campaignId} />}
        />
      </div>
    </div>
  );
}
