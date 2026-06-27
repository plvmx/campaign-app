'use client';

import { useCallback, useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import MobileLayout from '@/components/MobileLayout';
import LoadingSpinner from '@/components/LoadingSpinner';
import { useUser } from '@/contexts/UserContext';
import { getTodayDateString, formatDateForDb } from '@/lib/campaignDates';
import { getUserLocation } from '@/lib/location';
import { supabase } from '@/lib/supabaseClient';
import { getNearbyCampaigns, type NearbyMapMarker } from '@/lib/services/nearbyCampaignsService';
import { getErrorMessage } from '@/lib/errorUtils';

const NearbyCampaignsMap = dynamic(() => import('@/components/NearbyCampaignsMap'), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center text-sm text-gray-500 dark:text-gray-400">
      Loading map…
    </div>
  ),
});

const RADIUS_KM = 60;

function defaultEndDate(): string {
  const date = new Date();
  date.setDate(date.getDate() + 30);
  return formatDateForDb(date);
}

export default function CampaignsNearMePage() {
  const router = useRouter();
  const { user, isAdmin, isLoading: isUserLoading } = useUser();
  const [hasAccess, setHasAccess] = useState(false);
  const [accessError, setAccessError] = useState<string | null>(null);

  const [startDate, setStartDate] = useState(getTodayDateString());
  const [endDate, setEndDate] = useState(defaultEndDate());

  // Centre point: either browser geolocation or a geocoded address.
  const [center, setCenter] = useState<[number, number] | null>(null);
  const [centerLabel, setCenterLabel] = useState<string>('Your current location');
  const [isLocating, setIsLocating] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);

  // Address entry — separate state from the active centre so the user can type
  // freely without re-triggering geocoding on every keystroke.
  const [addressInput, setAddressInput] = useState('');
  const [isGeocoding, setIsGeocoding] = useState(false);

  const [markers, setMarkers] = useState<NearbyMapMarker[]>([]);
  const [unresolvedCount, setUnresolvedCount] = useState(0);
  const [isLoadingMap, setIsLoadingMap] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);

  // Auth + access gate.
  useEffect(() => {
    if (isUserLoading) return;
    if (!user) { router.push('/login'); return; }
    Promise.resolve().then(() => {
      if (!isAdmin) {
        setAccessError('You do not have permission to access this page');
        return;
      }
      setHasAccess(true);
    });
  }, [isUserLoading, user, isAdmin, router]);

  // Initial geolocation attempt — only after access is granted to avoid prompting
  // users who'll see the access-denied screen anyway.
  const requestCurrentLocation = useCallback(async () => {
    setIsLocating(true);
    setLocationError(null);
    try {
      const { coords, deniedByUser } = await getUserLocation();
      if (coords) {
        setCenter([coords.latitude, coords.longitude]);
        setCenterLabel('Your current location');
      } else if (deniedByUser) {
        setLocationError('Location permission denied. Type an address below to choose a different centre.');
      } else {
        setLocationError('Could not get your location. Type an address below to choose a different centre.');
      }
    } finally {
      setIsLocating(false);
    }
  }, []);

  useEffect(() => {
    if (!hasAccess) return;
    if (center) return;
    requestCurrentLocation();
  }, [hasAccess, center, requestCurrentLocation]);

  // Refetch markers whenever the centre or date range changes.
  useEffect(() => {
    if (!hasAccess || !center) return;
    if (!startDate || !endDate) return;

    let cancelled = false;

    Promise.resolve()
      .then(() => {
        setIsLoadingMap(true);
        setMapError(null);
        return getNearbyCampaigns({
          startDate,
          endDate,
          centerLat: center[0],
          centerLng: center[1],
          radiusKm: RADIUS_KM,
        });
      })
      .then(result => {
        if (cancelled) return;
        setMarkers(result.markers);
        setUnresolvedCount(result.unresolvedPlaces.length);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setMapError(getErrorMessage(err, 'Failed to load nearby campaigns'));
      })
      .finally(() => {
        if (!cancelled) setIsLoadingMap(false);
      });

    return () => { cancelled = true; };
  }, [hasAccess, center, startDate, endDate]);

  const handleAddressSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const address = addressInput.trim();
    if (!address) return;

    setIsGeocoding(true);
    setLocationError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setLocationError('Your session has expired. Please sign in again.');
        return;
      }
      const response = await fetch('/api/admin/geocode-address', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ address }),
      });

      if (response.status === 404) {
        setLocationError(`No location found for "${address}". Try a more specific address.`);
        return;
      }
      if (!response.ok) {
        setLocationError('Could not look up that address. Please try again.');
        return;
      }

      const data = await response.json() as { latitude: number; longitude: number; displayName: string };
      setCenter([data.latitude, data.longitude]);
      setCenterLabel(data.displayName);
    } catch (err: unknown) {
      setLocationError(getErrorMessage(err, 'Could not look up that address'));
    } finally {
      setIsGeocoding(false);
    }
  };

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
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Campaigns Near Me</h1>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
              Upcoming campaigns within {RADIUS_KM} km of your location
            </p>
          </div>
          <button
            onClick={() => router.push('/admin')}
            className="shrink-0 rounded-md bg-gray-200 px-3 py-2 text-base font-bold text-gray-700 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600 border-2 border-gray-800 dark:border-gray-600"
          >
            Back
          </button>
        </div>

        <div className="mb-3 grid grid-cols-2 gap-3">
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
        </div>

        <form onSubmit={handleAddressSubmit} className="mb-3">
          <label className="block text-xs font-medium text-gray-700 dark:text-gray-300">
            Centre on address
          </label>
          <div className="mt-1 flex gap-2">
            <input
              type="text"
              value={addressInput}
              onChange={e => setAddressInput(e.target.value)}
              placeholder="e.g. 100 Collins St, Melbourne"
              className="flex-1 rounded-md border border-gray-300 px-2 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
            />
            <button
              type="submit"
              disabled={isGeocoding || !addressInput.trim()}
              className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-bold text-white hover:bg-blue-700 disabled:bg-gray-400 border-2 border-gray-800 dark:border-gray-600"
            >
              {isGeocoding ? 'Locating…' : 'Use address'}
            </button>
            <button
              type="button"
              onClick={() => { setAddressInput(''); requestCurrentLocation(); }}
              disabled={isLocating}
              className="rounded-md bg-gray-200 px-3 py-1.5 text-sm font-bold text-gray-700 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-300 disabled:opacity-50 border-2 border-gray-800 dark:border-gray-600"
              title="Use my current location"
            >
              {isLocating ? '…' : 'My location'}
            </button>
          </div>
        </form>

        {locationError && (
          <div className="mb-3 rounded-lg border border-yellow-200 bg-yellow-50 p-3 text-sm text-yellow-800 dark:border-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-200">
            {locationError}
          </div>
        )}

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

        {center && (
          <div className="mb-2 text-xs text-gray-600 dark:text-gray-400">
            Centred on: <span className="font-medium">{centerLabel}</span>
            {' · '}
            {markers.length} campaign{markers.length === 1 ? '' : 's'} within {RADIUS_KM} km
          </div>
        )}

        <div className="relative flex-1 overflow-hidden rounded-lg border-2 border-gray-800 dark:border-gray-600">
          {(isLoadingMap || isLocating) && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/60 dark:bg-gray-900/60">
              <LoadingSpinner />
            </div>
          )}
          {center ? (
            <NearbyCampaignsMap center={center} radiusKm={RADIUS_KM} markers={markers} />
          ) : (
            <div className="flex h-full items-center justify-center p-4 text-center text-sm text-gray-500 dark:text-gray-400">
              {isLocating
                ? 'Getting your location…'
                : 'Enter an address above or allow location access to see nearby campaigns.'}
            </div>
          )}
        </div>
      </div>
    </MobileLayout>
  );
}
