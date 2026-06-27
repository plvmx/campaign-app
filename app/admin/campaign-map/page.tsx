'use client';

import { useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import MobileLayout from '@/components/MobileLayout';
import LoadingSpinner from '@/components/LoadingSpinner';
import { useUser } from '@/contexts/UserContext';
import { AUSTRALIAN_STATES, AUSTRALIA_MAP_CENTER, STATE_MAP_CENTERS, type AustralianState } from '@/lib/constants';
import { getTodayDateString, formatDateForDb } from '@/lib/campaignDates';
import { getMapData, type MapMarker } from '@/lib/services/campaignMapService';
import { getErrorMessage } from '@/lib/errorUtils';

const CampaignMap = dynamic(() => import('@/components/CampaignMap'), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center text-sm text-gray-500 dark:text-gray-400">
      Loading map…
    </div>
  ),
});

function defaultEndDate(): string {
  const date = new Date();
  date.setDate(date.getDate() + 30);
  return formatDateForDb(date);
}

export default function CampaignMapPage() {
  const router = useRouter();
  const { user, isAdmin, isLoading: isUserLoading } = useUser();
  const [hasAccess, setHasAccess] = useState(false);
  const [accessError, setAccessError] = useState<string | null>(null);

  const [startDate, setStartDate] = useState(getTodayDateString());
  const [endDate, setEndDate] = useState(defaultEndDate());
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

  const { center, zoom } = useMemo(() => {
    if (selectedState) {
      const target = STATE_MAP_CENTERS[selectedState];
      return { center: [target.lat, target.lng] as [number, number], zoom: target.zoom };
    }
    return { center: [AUSTRALIA_MAP_CENTER.lat, AUSTRALIA_MAP_CENTER.lng] as [number, number], zoom: AUSTRALIA_MAP_CENTER.zoom };
  }, [selectedState]);

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
      <div className="flex h-[calc(100vh-4rem)] flex-col p-4">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Campaign Map</h1>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
              Upcoming campaigns plotted by location across Australia
            </p>
          </div>
          <button
            onClick={() => router.push('/admin')}
            className="shrink-0 rounded-md bg-gray-200 px-3 py-2 text-base font-bold text-gray-700 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600 border-2 border-gray-800 dark:border-gray-600"
          >
            Back
          </button>
        </div>

        <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div>
            <label className="block text-xs font-medium text-gray-700 dark:text-gray-300">From</label>
            <input
              type="date"
              value={startDate}
              onChange={e => setStartDate(e.target.value)}
              className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 dark:text-gray-300">To</label>
            <input
              type="date"
              value={endDate}
              onChange={e => setEndDate(e.target.value)}
              className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
            />
          </div>
          <div className="col-span-2 sm:col-span-2">
            <label className="block text-xs font-medium text-gray-700 dark:text-gray-300">State</label>
            <select
              value={selectedState}
              onChange={e => setSelectedState(e.target.value as AustralianState | '')}
              className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
            >
              <option value="">All states</option>
              {AUSTRALIAN_STATES.map(state => (
                <option key={state} value={state}>{state}</option>
              ))}
            </select>
          </div>
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

        <div className="relative flex-1 overflow-hidden rounded-lg border-2 border-gray-800 dark:border-gray-600">
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
