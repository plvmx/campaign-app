'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import MobileLayout from '@/components/MobileLayout';
import LoadingSpinner from '@/components/LoadingSpinner';
import { useUser } from '@/contexts/UserContext';
import { fetchUnresolvedLocations, saveLocationMapping } from '@/lib/services/campaignReportLocationsClient';
import type { UnresolvedLocation } from '@/lib/services/campaignReportLocationsService';
import { getErrorMessage } from '@/lib/errorUtils';
import { AUSTRALIAN_STATES } from '@/lib/constants';

const ADD_NEW = '__add_new__';

interface Draft {
  state: string;
  place: string; // a state_places place, '' for state only, or ADD_NEW
  newPlace: string;
}

type SaveState = 'idle' | 'saving' | 'error';

export default function CampaignReportLocationsPage() {
  const router = useRouter();
  const { user, isAdmin, isLoading: isUserLoading } = useUser();

  const [hasAccess, setHasAccess] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [locations, setLocations] = useState<UnresolvedLocation[]>([]);
  const [places, setPlaces] = useState<{ state: string; place: string }[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [saveStates, setSaveStates] = useState<Record<string, SaveState>>({});
  const [saveErrors, setSaveErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (isUserLoading) return;
    if (!user) { router.push('/login'); return; }
    if (!isAdmin) {
      setLoadError('You do not have permission to access this page');
      return;
    }
    setHasAccess(true);
  }, [isUserLoading, user, isAdmin, router]);

  const load = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const data = await fetchUnresolvedLocations();
      setLocations(data.locations);
      setPlaces(data.places);
      const next: Record<string, Draft> = {};
      for (const l of data.locations) {
        const s = l.suggestions.length === 1 ? l.suggestions[0] : null;
        next[l.key] = { state: s?.state ?? l.knownState ?? '', place: s?.place ?? '', newPlace: '' };
      }
      setDrafts(next);
      setSaveStates({});
    } catch (err: unknown) {
      setLoadError(getErrorMessage(err, 'Error loading locations'));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (hasAccess) load();
  }, [hasAccess, load]);

  const update = (key: string, patch: Partial<Draft>) => {
    setDrafts((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }));
    setSaveStates((prev) => ({ ...prev, [key]: 'idle' }));
  };

  const save = async (loc: UnresolvedLocation) => {
    const d = drafts[loc.key];
    if (!d?.state) return;
    setSaveStates((prev) => ({ ...prev, [loc.key]: 'saving' }));
    try {
      const rowsUpdated = await saveLocationMapping({
        locationKey: loc.key,
        state: d.state,
        place: d.place && d.place !== ADD_NEW ? d.place : null,
        newPlace: d.place === ADD_NEW ? d.newPlace : null,
      });
      setNotice(`Saved "${loc.example}" — ${rowsUpdated} record${rowsUpdated === 1 ? '' : 's'} updated.`);
      if (d.place === ADD_NEW && d.newPlace.trim()) {
        setPlaces((prev) => [...prev, { state: d.state, place: d.newPlace.trim() }]);
      }
      // A place-level mapping completes this location; a state-only one stays listed so it isn't forgotten.
      if (d.place) setLocations((prev) => prev.filter((l) => l.key !== loc.key));
      else setSaveStates((prev) => ({ ...prev, [loc.key]: 'idle' }));
    } catch (err: unknown) {
      setSaveStates((prev) => ({ ...prev, [loc.key]: 'error' }));
      setSaveErrors((prev) => ({ ...prev, [loc.key]: getErrorMessage(err, 'Failed to save') }));
    }
  };

  if (isUserLoading || (isLoading && hasAccess)) {
    return (
      <MobileLayout>
        <div className="flex min-h-screen items-center justify-center">
          <LoadingSpinner text="Loading locations…" />
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
              {loadError || 'You do not have permission to access this page.'}
            </p>
            <a href="/admin" className="mt-4 inline-block rounded-md bg-red-600 px-4 py-2 text-base font-bold text-white hover:bg-red-700 border-2 border-gray-800 dark:border-gray-600">
              Go Back
            </a>
          </div>
        </div>
      </MobileLayout>
    );
  }

  const totalRows = locations.reduce((n, l) => n + l.rows, 0);

  return (
    <MobileLayout>
      <div className="p-4 pb-28">
        <div className="mb-6">
          <a href="/admin" className="mb-4 inline-block text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400">
            ← Back to Admin Panel
          </a>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Campaign Report Locations</h1>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            Locations typed in the Campaign Report sheet that don&apos;t match a place in State Places yet.
            Pick the state and place for each — it is applied to every record with that spelling, and to new
            ones as they arrive. Choose &ldquo;Add as new place&rdquo; for a place that is no longer (or never
            was) in State Places; it will also appear in State Places and campaign dropdowns.
          </p>
        </div>

        {loadError && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-800 dark:bg-red-900/20">
            <p className="text-sm text-red-600 dark:text-red-300">{loadError}</p>
          </div>
        )}
        {notice && (
          <div className="mb-4 rounded-lg border border-green-300 bg-green-50 p-3 text-sm text-green-800 dark:border-green-700 dark:bg-green-900/20 dark:text-green-200">
            {notice}
          </div>
        )}

        <div className="mb-4 flex items-center justify-between">
          <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
            {locations.length} location{locations.length === 1 ? '' : 's'} ({totalRows} records) remaining
          </p>
          <button
            type="button"
            onClick={load}
            className="rounded-md border-2 border-gray-400 bg-white px-3 py-1.5 text-sm font-semibold text-gray-700 hover:bg-gray-50 dark:border-gray-500 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600"
          >
            Refresh
          </button>
        </div>

        {locations.length === 0 && !isLoading && (
          <div className="rounded-lg border-2 border-green-300 bg-green-50 p-6 text-center dark:border-green-700 dark:bg-green-900/20">
            <p className="text-base font-semibold text-green-800 dark:text-green-200">Every location maps to a place 🎉</p>
          </div>
        )}

        <div className="space-y-4">
          {locations.map((loc) => {
            const d = drafts[loc.key] ?? { state: '', place: '', newPlace: '' };
            const saveState = saveStates[loc.key] ?? 'idle';
            const stateOptions = places.filter((p) => p.state === d.state);
            return (
              <div key={loc.key} className="rounded-lg border-2 border-gray-300 bg-white p-4 shadow-sm dark:border-gray-600 dark:bg-gray-800">
                <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 border-b border-gray-200 pb-2 dark:border-gray-700">
                  <p className="text-base font-semibold text-gray-900 dark:text-gray-100">{loc.example}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    {loc.rows} record{loc.rows === 1 ? '' : 's'}
                    {loc.knownState ? ` · state ${loc.knownState}` : ''}
                  </p>
                </div>

                {loc.suggestions.length > 0 && (
                  <div className="mb-3 flex flex-wrap items-center gap-2">
                    <span className="text-xs font-medium text-gray-500 dark:text-gray-400">Suggestions:</span>
                    {loc.suggestions.map((s) => (
                      <button
                        key={`${s.state}-${s.place}`}
                        type="button"
                        onClick={() => update(loc.key, { state: s.state, place: s.place })}
                        className="rounded-full border border-blue-400 bg-blue-50 px-3 py-0.5 text-xs font-semibold text-blue-800 hover:bg-blue-100 dark:border-blue-500 dark:bg-blue-900/30 dark:text-blue-200"
                      >
                        {s.place} ({s.state})
                      </button>
                    ))}
                  </div>
                )}

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label className="block text-xs font-medium text-gray-700 dark:text-gray-300">State</label>
                    <select
                      value={d.state}
                      onChange={(e) => update(loc.key, { state: e.target.value, place: '', newPlace: '' })}
                      className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                    >
                      <option value="">— Select —</option>
                      {AUSTRALIAN_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 dark:text-gray-300">Place</label>
                    <select
                      value={d.place}
                      onChange={(e) => update(loc.key, { place: e.target.value })}
                      disabled={!d.state}
                      className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm disabled:bg-gray-100 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:disabled:bg-gray-800"
                    >
                      <option value="">{d.state ? '— State only —' : 'Select a state first'}</option>
                      {stateOptions.map((p) => <option key={p.place} value={p.place}>{p.place}</option>)}
                      {d.state && <option value={ADD_NEW}>+ Add as new place…</option>}
                    </select>
                  </div>
                </div>

                {d.place === ADD_NEW && (
                  <div className="mt-3">
                    <label className="block text-xs font-medium text-gray-700 dark:text-gray-300">New place name (added to State Places for {d.state})</label>
                    <input
                      value={d.newPlace}
                      onChange={(e) => update(loc.key, { newPlace: e.target.value })}
                      placeholder="e.g. Port Macquarie"
                      className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                    />
                  </div>
                )}

                <div className="mt-3 flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => save(loc)}
                    disabled={saveState === 'saving' || !d.state || (d.place === ADD_NEW && !d.newPlace.trim())}
                    className="rounded-md bg-blue-600 px-4 py-1.5 text-sm font-bold text-white hover:bg-blue-700 disabled:bg-gray-400 border-2 border-gray-800 dark:border-gray-600"
                  >
                    {saveState === 'saving' ? 'Saving…' : 'Save'}
                  </button>
                  {saveState === 'error' && (
                    <span className="text-sm font-medium text-red-700 dark:text-red-400">{saveErrors[loc.key] || 'Failed to save'}</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </MobileLayout>
  );
}
