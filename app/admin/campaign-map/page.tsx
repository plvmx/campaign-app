'use client';

import { useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import MobileLayout from '@/components/MobileLayout';
import LoadingSpinner from '@/components/LoadingSpinner';
import { useUser } from '@/contexts/UserContext';
import { useCampaignDates } from '@/contexts/CampaignDatesContext';
import { AUSTRALIAN_STATES, AUSTRALIA_MAP_CENTER, STATE_MAP_CENTERS, type AustralianState } from '@/lib/constants';
import { formatDateForDb, formatWeekRangeLabel } from '@/lib/campaignDates';
import { getMapData, type MapMarker } from '@/lib/services/campaignMapService';
import { getErrorMessage } from '@/lib/errorUtils';
import { getUserLocation } from '@/lib/location';

/** Approximate zoom level for a ~60km-radius view (matches the small-territory
 *  entries in STATE_MAP_CENTERS, e.g. ACT, which cover a similar area). */
const NEAR_ME_ZOOM = 10;

const CampaignMap = dynamic(() => import('@/components/CampaignMap'), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center text-sm text-gray-500 dark:text-gray-400">
      Loading map…
    </div>
  ),
});

export default function CampaignMapPage() {
  const router = useRouter();
  const { user, isAdmin, userState, isLoading: isUserLoading } = useUser();
  const { dates: campaignDates } = useCampaignDates();
  const [hasAccess, setHasAccess] = useState(false);
  const [accessError, setAccessError] = useState<string | null>(null);

  // Week 1 is the upcoming campaign week; Week 2 is the one after it. The
  // toggle below picks which week's campaigns are queried — Week 1 by default.
  const [selectedWeek, setSelectedWeek] = useState<1 | 2>(1);

  const weeks = useMemo(() => {
    if (!campaignDates) return null;
    const week1Start = campaignDates.upcomingCampaignStart;
    const week2Start = campaignDates.secondWeekStart;
    return {
      1: { startDate: formatDateForDb(week1Start), label: formatWeekRangeLabel(week1Start) },
      2: { startDate: formatDateForDb(week2Start), label: formatWeekRangeLabel(week2Start) },
    };
  }, [campaignDates]);

  const { startDate, endDate } = useMemo(() => {
    if (!weeks) return { startDate: '', endDate: '' };
    const start = weeks[selectedWeek].startDate;
    const [y, m, d] = start.split('-').map(Number);
    const end = new Date(y, m - 1, d + 6);
    return { startDate: start, endDate: formatDateForDb(end) };
  }, [weeks, selectedWeek]);

  const [selectedState, setSelectedState] = useState<AustralianState | ''>('');

  const [markers, setMarkers] = useState<MapMarker[]>([]);
  const [unresolvedCount, setUnresolvedCount] = useState(0);
  const [isLoadingMap, setIsLoadingMap] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);

  useEffect(() => {
    if (isUserLoading) return;
    if (!user) { router.push('/login'); return; }
    // setState is deferred through a resolved Promise to avoid synchronous setState
    // inside the effect body, matching the pattern used elsewhere in the app.
    Promise.resolve().then(() => {
      if (!isAdmin) {
        setAccessError('You do not have permission to access this page');
        return;
      }
      setHasAccess(true);
    });
  }, [isUserLoading, user, isAdmin, router]);

  useEffect(() => {
    if (!hasAccess) return;
    if (!startDate || !endDate) return;

    let cancelled = false;

    Promise.resolve()
      .then(() => {
        setIsLoadingMap(true);
        setMapError(null);
        return getMapData({ startDate, endDate, state: selectedState || undefined });
      })
      .then(result => {
        if (cancelled) return;
        setMarkers(result.markers);
        setUnresolvedCount(result.unresolvedPlaces.length);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setMapError(getErrorMessage(err, 'Failed to load campaigns for the map'));
      })
      .finally(() => {
        if (!cancelled) setIsLoadingMap(false);
      });

    return () => { cancelled = true; };
  }, [hasAccess, startDate, endDate, selectedState]);

  // "Near Me" override — takes precedence over the state selector until the
  // user picks a state explicitly (which clears it, see the <select> below).
  const [nearMeTarget, setNearMeTarget] = useState<{ center: [number, number]; zoom: number } | null>(null);
  const [isLocatingNearMe, setIsLocatingNearMe] = useState(false);
  const [nearMeNotice, setNearMeNotice] = useState<string | null>(null);

  const handleNearMe = async () => {
    setIsLocatingNearMe(true);
    setNearMeNotice(null);
    try {
      const { coords, deniedByUser } = await getUserLocation();
      if (coords) {
        setNearMeTarget({ center: [coords.latitude, coords.longitude], zoom: NEAR_ME_ZOOM });
        return;
      }
      const fallbackState = userState && (AUSTRALIAN_STATES as readonly string[]).includes(userState)
        ? (userState as AustralianState)
        : null;
      if (fallbackState) {
        const target = STATE_MAP_CENTERS[fallbackState];
        setNearMeTarget({ center: [target.lat, target.lng], zoom: target.zoom });
        setNearMeNotice(
          deniedByUser
            ? 'Location permission denied — showing your state instead.'
            : 'Could not determine your location — showing your state instead.'
        );
      } else {
        setNearMeNotice(
          deniedByUser
            ? 'Location permission denied and no state on file for your account.'
            : 'Could not determine your location and no state on file for your account.'
        );
      }
    } finally {
      setIsLocatingNearMe(false);
    }
  };

  const { center, zoom } = useMemo(() => {
    if (nearMeTarget) return nearMeTarget;
    if (selectedState) {
      const target = STATE_MAP_CENTERS[selectedState];
      return { center: [target.lat, target.lng] as [number, number], zoom: target.zoom };
    }
    return { center: [AUSTRALIA_MAP_CENTER.lat, AUSTRALIA_MAP_CENTER.lng] as [number, number], zoom: AUSTRALIA_MAP_CENTER.zoom };
  }, [selectedState, nearMeTarget]);

  if (isUserLoading) {
    return (
      <MobileLayout>
        <div className="flex min-h-screen items-center justify-center">
          <LoadingSpinner />
        </div>
      </MobileLayout>
    );
  }

  if (!hasAccess) {
    return (
      <MobileLayout>
        <div className="p-4">
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-800 dark:bg-red-900/20">
            <h2 className="text-lg font-semibold text-red-800 dark:text-red-200">Access Denied</h2>
            <p className="mt-1 text-sm text-red-600 dark:text-red-300">
              {accessError || 'You do not have permission to access this page.'}
            </p>
            <button
              onClick={() => router.push('/app')}
              className="mt-4 rounded-md bg-red-600 px-4 py-2 text-base font-bold text-white hover:bg-red-700 border-2 border-gray-800 dark:border-gray-600"
            >
              Go Back
            </button>
          </div>
        </div>
      </MobileLayout>
    );
  }

  return (
    <MobileLayout>
      {/* 100dvh (not vh) so mobile browser chrome that shows/hides on scroll doesn't
          throw the height off. Subtracts the header (4rem), the fixed bottom nav
          (5rem, matching MobileLayout's own pb-20 reservation for it), and the
          dismissible PWA install banner's live height (--pwa-banner-height, set by
          PWAInstallPrompt — it renders outside MobileLayout in the root layout and
          pushes this page down by a variable amount) — otherwise the map renders
          underneath the Home/Metrics/Admin buttons whenever that banner is showing. */}
      <div className="flex h-[calc(100dvh-var(--pwa-banner-height,0px)-4rem-5rem)] flex-col p-4">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Upcoming AFJ Campaigns</h1>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
              Click on a coloured campaign marker to view details or to register your interest in the campaign. Use your fingers or mouse to zoom in and out, or move around the map
            </p>
          </div>
          <button
            onClick={() => router.push('/admin')}
            className="shrink-0 rounded-md bg-gray-200 px-3 py-2 text-base font-bold text-gray-700 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600 border-2 border-gray-800 dark:border-gray-600"
          >
            Back
          </button>
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
                    : 'bg-white text-gray-700 border-gray-400 hover:bg-gray-50 dark:bg-gray-800 dark:text-gray-200 dark:border-gray-600 dark:hover:bg-gray-700'
                }`}
              >
                Week {week} ({weeks[week].label})
              </button>
            ))}
          </div>
        )}

        <div className="mb-3">
          <select
            value={selectedState}
            onChange={e => {
              setSelectedState(e.target.value as AustralianState | '');
              setNearMeTarget(null);
              setNearMeNotice(null);
            }}
            className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
          >
            <option value="">All states</option>
            {AUSTRALIAN_STATES.map(state => (
              <option key={state} value={state}>{state}</option>
            ))}
          </select>
        </div>

        {mapError && (
          <div className="mb-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-900/20 dark:text-red-200">
            {mapError}
          </div>
        )}

        {!mapError && unresolvedCount > 0 && (
          <div className="mb-3 rounded-lg border border-yellow-200 bg-yellow-50 p-3 text-sm text-yellow-800 dark:border-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-200">
            {unresolvedCount} place{unresolvedCount === 1 ? '' : 's'} could not be located on the map.
          </div>
        )}

        {nearMeNotice && (
          <div className="mb-3 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800 dark:border-blue-800 dark:bg-blue-900/20 dark:text-blue-200">
            {nearMeNotice}
          </div>
        )}

        <div className="relative flex-1 overflow-hidden rounded-lg border-2 border-gray-800 dark:border-gray-600">
          <button
            type="button"
            onClick={handleNearMe}
            disabled={isLocatingNearMe}
            className="absolute top-2 right-2 z-[1000] rounded-md border-2 border-gray-800 bg-white px-2 py-1 text-xs font-bold text-gray-700 shadow hover:bg-gray-100 disabled:opacity-60 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
          >
            {isLocatingNearMe ? 'Locating…' : '📍 Near Me'}
          </button>
          {isLoadingMap && (
            // z-[1100] keeps the overlay above Leaflet's stacked panes (tile=200,
            // overlay=400, marker=600, popup=700, controls=~1000) — otherwise the
            // loading message disappears the moment Leaflet paints its first tile.
            <div className="absolute inset-0 z-[1100] flex flex-col items-center justify-center gap-3 bg-white/80 px-6 text-center dark:bg-gray-900/80">
              <LoadingSpinner text="Please wait — locating campaigns on the map" />
              <p className="max-w-sm text-xs text-gray-600 dark:text-gray-400">
                This can take up to 15 seconds the first time, while new place locations are looked up. Subsequent loads are instant.
              </p>
            </div>
          )}
          <CampaignMap center={center} zoom={zoom} markers={markers} />
        </div>
      </div>
    </MobileLayout>
  );
}
