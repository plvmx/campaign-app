'use client';

/**
 * Public "Upcoming Campaigns" map (/public/upcoming-campaigns) — the
 * general-public replacement for the admin-only "View Campaign Map"
 * screen (formerly /admin/campaign-map, removed from the Admin console's
 * "In Development" section once this shipped). Backed by
 * app/api/public/upcoming-campaigns/route.ts for markers (and, for the
 * List View toggle below, the same date range's campaigns as a flat list)
 * and app/api/public/geocode-postcode/route.ts for the postcode-based
 * "Near Me" recentre — no browser geolocation prompt, since an anonymous
 * visitor types their own postcode instead.
 *
 * The header/intro/This Week/Next Week toggle above the map are shared
 * between Map View and List View — only the box below them swaps, so
 * toggling views never changes the top of the page (Peter's request).
 */
import { useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { useCampaignDates } from '@/contexts/CampaignDatesContext';
import { AUSTRALIA_MAP_CENTER } from '@/lib/constants';
import { formatDateForDb, formatShortWeekRange } from '@/lib/campaignDates';
import { getErrorMessage } from '@/lib/errorUtils';
import type { UpcomingCampaignsResponse } from '@/app/api/public/upcoming-campaigns/route';
import PublicMapRegisterInterestActions from '@/components/PublicMapRegisterInterestActions';
import PublicRegisterInterestModal, { type PublicInterestType } from '@/components/PublicRegisterInterestModal';
import CampaignCheckboxList from '@/components/registerInterest/CampaignCheckboxList';

/** Same larger, darker markers as the Near Me map, so circles read as tappable. */
const MARKER_STYLE = { size: 30, fillOpacity: 0.5 };

/** Approximate zoom level for a ~60km-radius view around a postcode. */
const POSTCODE_ZOOM = 10;

const CampaignMap = dynamic(() => import('@/components/CampaignMap'), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center text-sm text-gray-500">Loading map…</div>
  ),
});

export default function UpcomingCampaignsClient() {
  // Lets a visitor who'd rather not use the map see the same campaigns as
  // a checklist instead — same data/submit flow as /public/register-interest
  // (CampaignCheckboxList + PublicRegisterInterestModal), for the same
  // This Week/Next Week range the map is showing.
  const [viewMode, setViewMode] = useState<'map' | 'list'>('map');

  const { dates: campaignDates } = useCampaignDates();

  // Week 1 is the upcoming campaign week; Week 2 is the one after it.
  const [selectedWeek, setSelectedWeek] = useState<1 | 2>(1);

  const weeks = useMemo(() => {
    if (!campaignDates) return null;
    const week1Start = campaignDates.upcomingCampaignStart;
    const week2Start = campaignDates.secondWeekStart;
    return {
      1: { startDate: formatDateForDb(week1Start), rangeText: formatShortWeekRange(week1Start) },
      2: { startDate: formatDateForDb(week2Start), rangeText: formatShortWeekRange(week2Start) },
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
  const [campaigns, setCampaigns] = useState<UpcomingCampaignsResponse['campaigns']>([]);
  const [unresolvedCount, setUnresolvedCount] = useState(0);
  const [isLoadingMap, setIsLoadingMap] = useState(false);
  // Stays false until the first response lands, so the summary line doesn't claim "no campaigns" before anything has loaded.
  const [hasLoaded, setHasLoaded] = useState(false);
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
        setCampaigns(result.campaigns);
        setUnresolvedCount(result.unresolvedCount);
        setHasLoaded(true);
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

  // List View — same checklist + confirmation popup as /public/register-interest,
  // for the same week's campaigns the map would otherwise show.
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const toggleChecked = (id: string) => {
    setCheckedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const [listValidationError, setListValidationError] = useState<string | null>(null);
  const [listPopupAction, setListPopupAction] = useState<PublicInterestType | null>(null);

  const openListPopup = (action: PublicInterestType) => {
    setListValidationError(null);
    if (checkedIds.size === 0) {
      setListValidationError('Tick at least one campaign below first.');
      return;
    }
    setListPopupAction(action);
  };

  const handleListSuccess = () => {
    setCheckedIds(new Set());
    setListPopupAction(null);
  };

  return (
    <div data-ti="app/public/upcoming-campaigns/UpcomingCampaignsClient.tsx" className="mx-auto flex h-[100dvh] max-w-4xl flex-col p-4">
      <div className="mb-3">
        <h1 className="text-2xl font-bold text-gray-900">Upcoming AFJ Campaigns</h1>
        <ol className="mt-2 space-y-1 rounded-lg border border-blue-200 bg-blue-50 p-3 text-base font-medium text-blue-900">
          <li><span className="font-bold">1.</span> Choose a week below.</li>
          <li><span className="font-bold">2.</span> {viewMode === 'map' ? 'Tap a coloured circle on the map (or type your postcode) to see the campaign.' : 'Tick the campaigns you are interested in.'}</li>
          <li><span className="font-bold">3.</span> Tap <span className="font-bold">Yes I&apos;m In</span> or <span className="font-bold">Tell Me More</span>.</li>
        </ol>
      </div>

      {weeks && (
        <div className="mb-3 flex gap-2">
          {([1, 2] as const).map(week => (
            <button
              key={week}
              type="button"
              onClick={() => setSelectedWeek(week)}
              aria-pressed={selectedWeek === week}
              className={`flex-1 rounded-md px-3 py-2 text-sm font-semibold border-2 transition-colors ${
                selectedWeek === week
                  ? 'bg-blue-600 text-white border-blue-700'
                  : 'bg-white text-gray-700 border-gray-400 hover:bg-gray-50'
              }`}
            >
              {week === 1 ? 'This Week' : 'Next Week'}
              <span className="block text-xs font-normal">{weeks[week].rangeText}</span>
            </button>
          ))}
        </div>
      )}

      <div className="mb-2 flex gap-2" role="group" aria-label="View">
        {([['map', 'Map'], ['list', 'List']] as const).map(([mode, label]) => (
          <button
            key={mode}
            type="button"
            onClick={() => setViewMode(mode)}
            aria-pressed={viewMode === mode}
            className={`flex-1 rounded-md px-3 py-2 text-sm font-semibold border-2 ${
              viewMode === mode
                ? 'bg-gray-800 text-white border-gray-800'
                : 'bg-white text-gray-700 border-gray-400 hover:bg-gray-50'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {hasLoaded && !isLoadingMap && !mapError && (
        <p className="mb-2 text-sm font-medium text-gray-700" data-testid="campaign-summary">
          {campaigns.length === 0
            ? 'No campaigns are listed for this week yet — try the other week.'
            : `${campaigns.length} campaign${campaigns.length === 1 ? '' : 's'} this ${selectedWeek === 1 ? 'week' : 'coming week'}${viewMode === 'map' ? ` in ${markers.length} place${markers.length === 1 ? '' : 's'}` : ''}.`}
        </p>
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

      {viewMode === 'list' && listValidationError && (
        <div className="mb-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {listValidationError}
        </div>
      )}

      {viewMode === 'map' ? (
        <div className="relative flex-1 overflow-hidden rounded-lg border-2 border-gray-800">
          <div className="absolute top-2 right-2 z-[1000] w-fit max-w-[calc(100%-1rem)] rounded-md border-2 border-gray-800 bg-white px-3 py-2 shadow">
            <form onSubmit={handlePostcodeSubmit}>
              <p className="whitespace-nowrap text-center text-xs text-gray-700">
                Show me Campaigns <strong className="font-bold">Near Me</strong>
              </p>
              <div className="mt-1 flex flex-nowrap items-center justify-center gap-2">
                <label className="whitespace-nowrap text-xs text-gray-700">My Postcode is</label>
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
              </div>
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
            markerStyle={MARKER_STYLE}
            renderActions={({ campaignId }) => <PublicMapRegisterInterestActions campaignId={campaignId} />}
          />
        </div>
      ) : (
        <>
          <div className="relative flex-1 overflow-hidden rounded-lg border-2 border-gray-800">
            {isLoadingMap && (
              <div className="absolute inset-0 z-[1100] flex flex-col items-center justify-center gap-3 bg-white/80 px-6 text-center">
                <p className="text-sm text-gray-700">Please wait — loading campaigns</p>
              </div>
            )}
            <div className="h-full overflow-y-auto">
              <CampaignCheckboxList campaigns={campaigns} checkedIds={checkedIds} onToggle={toggleChecked} />
            </div>
          </div>

          <div className="mt-3 flex shrink-0 gap-2">
            <button
              type="button"
              onClick={() => openListPopup('in')}
              className="flex-1 rounded-md bg-green-600 px-4 py-3 text-base font-bold text-white hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 border-2 border-gray-800"
            >
              Yes I&apos;m In
            </button>
            <button
              type="button"
              onClick={() => openListPopup('more')}
              className="flex-1 rounded-md bg-orange-500 px-4 py-3 text-base font-bold text-white hover:bg-orange-600 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:ring-offset-2 border-2 border-gray-800"
            >
              Tell Me More
            </button>
          </div>

          {listPopupAction && (
            <PublicRegisterInterestModal
              campaignIds={[...checkedIds]}
              interestType={listPopupAction}
              onCancel={() => setListPopupAction(null)}
              onSuccess={handleListSuccess}
            />
          )}
        </>
      )}
    </div>
  );
}
