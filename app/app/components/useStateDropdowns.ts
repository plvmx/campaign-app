'use client';
import { useState, useEffect, useRef } from 'react';
import { getPlacesForState, getLeadersForState } from '@/lib/services/dropdownService';

interface UseStateDropdownsResult {
  places: string[];
  leaders: string[];
  loadingPlaces: boolean;
  loadingLeaders: boolean;
  /** Overwrite the cached places list for the given state (call after adding a new place). */
  updatePlacesCache: (state: string, updated: string[]) => void;
}

export function useStateDropdowns(state: string): UseStateDropdownsResult {
  const [places, setPlaces] = useState<string[]>([]);
  const [leaders, setLeaders] = useState<string[]>([]);
  const [loadingPlaces, setLoadingPlaces] = useState(false);
  const [loadingLeaders, setLoadingLeaders] = useState(false);
  const placesCache = useRef<Record<string, string[]>>({});
  const leadersCache = useRef<Record<string, string[]>>({});

  useEffect(() => {
    if (!state) return;
    const s = state.toUpperCase().trim();
    const existing = placesCache.current[s];
    // All setState calls go through Promise callbacks to avoid synchronous setState
    // inside an effect that also has async setState, which can cause cascading renders.
    (existing
      ? Promise.resolve(existing)
      : Promise.resolve()
          .then(() => { setLoadingPlaces(true); return getPlacesForState(s); })
          .then((p) => { placesCache.current[s] = p; return p; })
    ).then((p) => { setPlaces(p); setLoadingPlaces(false); });
  }, [state]);

  useEffect(() => {
    if (!state) return;
    const s = state.toUpperCase().trim();
    const existing = leadersCache.current[s];
    (existing
      ? Promise.resolve(existing)
      : Promise.resolve()
          .then(() => { setLoadingLeaders(true); return getLeadersForState(s); })
          .then((l) => { leadersCache.current[s] = l; return l; })
    ).then((l) => { setLeaders(l); setLoadingLeaders(false); });
  }, [state]);

  const updatePlacesCache = (s: string, updated: string[]) => {
    placesCache.current[s.toUpperCase().trim()] = updated;
    setPlaces(updated);
  };

  return { places, leaders, loadingPlaces, loadingLeaders, updatePlacesCache };
}
