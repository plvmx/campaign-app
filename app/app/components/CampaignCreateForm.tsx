'use client';
import { useState, useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { getPlacesForState, getLeadersForState, getLeaderMobile } from '@/lib/services/dropdownService';
import { createCampaign } from '@/lib/services/campaignService';
import { trackEvent } from '@/lib/analytics';
import { getErrorMessage } from '@/lib/errorUtils';
import { getTodayDateString } from '@/lib/campaignDates';
import { AUSTRALIAN_STATES } from '@/lib/constants';
import { TIME_OPTIONS } from './timeOptions';

interface Props {
  isAdmin: boolean;
  userState: string | null;
  userMobileAndLeader: { mobile: string | null; leader: string | null } | null;
  userId: string;
  categories: { code: string; name: string }[];
  onSuccess: () => void;
  onClose: () => void;
}

const fieldClass =
  'mt-1 block w-full rounded-md border-2 border-gray-400 bg-white px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500 dark:border-gray-500 dark:bg-gray-900 dark:text-white';

export default function CampaignCreateForm({
  isAdmin, userState, userMobileAndLeader, userId, categories, onSuccess, onClose,
}: Props) {
  const [formState, setFormState] = useState({
    date: getTodayDateString(),
    state: userState ? userState.toUpperCase().trim() : '',
    place: '',
    time: '',
    leader: '',
    mobile: '',
    category: 'TWOL',
    tl_ok: false,
    sr_ok: false,
  });
  const [isOtherPlace, setIsOtherPlace] = useState(false);
  const [customPlace, setCustomPlace] = useState('');
  const [places, setPlaces] = useState<string[]>([]);
  const [leaders, setLeaders] = useState<string[]>([]);
  const [loadingPlaces, setLoadingPlaces] = useState(false);
  const [loadingLeaders, setLoadingLeaders] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const placesCache = useRef<Record<string, string[]>>({});
  const leadersCache = useRef<Record<string, string[]>>({});

  useEffect(() => {
    if (!formState.state) { setPlaces([]); return; }
    const s = formState.state.toUpperCase().trim();
    if (placesCache.current[s]) { setPlaces(placesCache.current[s]); return; }
    setLoadingPlaces(true);
    getPlacesForState(s)
      .then((p) => { placesCache.current[s] = p; setPlaces(p); })
      .finally(() => setLoadingPlaces(false));
  }, [formState.state]);

  useEffect(() => {
    if (!formState.state) { setLeaders([]); return; }
    const s = formState.state.toUpperCase().trim();
    if (leadersCache.current[s]) { setLeaders(leadersCache.current[s]); return; }
    setLoadingLeaders(true);
    getLeadersForState(s)
      .then((l) => { leadersCache.current[s] = l; setLeaders(l); })
      .finally(() => setLoadingLeaders(false));
  }, [formState.state]);

  // Auto-fill leader/mobile for non-admin users once leaders are loaded
  useEffect(() => {
    if (isAdmin || !userMobileAndLeader?.leader || formState.leader || loadingLeaders) return;
    const stateMatches =
      (formState.state || '').toUpperCase().trim() === (userState || '').toUpperCase().trim();
    if (!stateMatches || !leaders.includes(userMobileAndLeader.leader)) return;
    setFormState((prev) => ({
      ...prev,
      leader: userMobileAndLeader.leader as string,
      mobile: userMobileAndLeader.mobile || prev.mobile,
    }));
  }, [isAdmin, userMobileAndLeader, userState, formState.state, formState.leader, leaders, loadingLeaders]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      let placeValue = formState.place;
      if (isOtherPlace && customPlace.trim()) {
        if (!formState.state?.trim()) throw new Error('Please select a state before entering a new place');
        const newPlace = customPlace.trim();
        const stateValue = formState.state.toUpperCase().trim();
        const { error: placeError } = await supabase
          .from('state_places')
          .insert([{ state: stateValue, place: newPlace }]);
        if (placeError && placeError.code !== '23505')
          throw new Error(`Failed to add new place: ${placeError.message}`);
        placeValue = newPlace;
        const updated = await getPlacesForState(stateValue);
        placesCache.current[stateValue] = updated;
        setPlaces(updated);
      }
      if (!placeValue?.trim()) throw new Error('Please select or enter a place');
      await createCampaign({
        date: formState.date,
        state: formState.state,
        place: placeValue,
        time: formState.time,
        leader: formState.leader,
        mobile: formState.mobile.trim() || null,
        category: formState.category ?? 'TWOL',
        tl_ok: formState.tl_ok,
        sr_ok: formState.sr_ok,
        user_id: userId,
        source: 'MAN',
      });
      trackEvent('campaign_create', { state: formState.state, category: formState.category ?? 'TWOL' });
      onSuccess();
      onClose();
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Failed to save campaign'));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="rounded-lg border-2 border-gray-800 dark:border-gray-600 bg-white shadow-sm dark:bg-gray-800 w-full overflow-hidden">
      <div className="flex items-center justify-between p-4">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Add Campaign</h2>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md bg-red-600 px-3 py-1 text-base font-bold text-white hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 border-2 border-gray-800 dark:border-gray-600"
        >
          Close
        </button>
      </div>
      <div className="p-4 pt-0 bg-blue-50 dark:bg-blue-900/20 rounded-b-lg">
        {error && (
          <div className="mb-4 rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-800 dark:bg-red-900/20 dark:border-red-800 dark:text-red-200">
            {error}
          </div>
        )}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="create-date" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Date</label>
            <input type="date" id="create-date" required value={formState.date}
              onChange={(e) => setFormState((p) => ({ ...p, date: e.target.value }))}
              className={fieldClass} />
          </div>
          <div>
            <label htmlFor="create-state" className="block text-sm font-medium text-gray-700 dark:text-gray-300">State</label>
            <select id="create-state" required value={formState.state}
              onChange={(e) => {
                setFormState((p) => ({ ...p, state: e.target.value, place: '', leader: '', mobile: '' }));
                setIsOtherPlace(false);
                setCustomPlace('');
              }}
              disabled={!isAdmin}
              className={`${fieldClass} disabled:opacity-50 disabled:cursor-not-allowed`}>
              <option value="">Select a state</option>
              {AUSTRALIAN_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="create-place" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Place</label>
            <select id="create-place" required={!isOtherPlace}
              value={isOtherPlace ? 'OTHER_PLACE' : formState.place}
              onChange={(e) => {
                if (e.target.value === 'OTHER_PLACE') {
                  setIsOtherPlace(true);
                  setFormState((p) => ({ ...p, place: '', leader: '', mobile: '' }));
                } else {
                  setIsOtherPlace(false);
                  setCustomPlace('');
                  setFormState((p) => ({ ...p, place: e.target.value, leader: '', mobile: '' }));
                }
              }}
              disabled={!formState.state || loadingPlaces}
              className={`${fieldClass} disabled:opacity-50`}>
              <option value="">{loadingPlaces ? 'Loading...' : 'Select a place'}</option>
              {places.map((p) => <option key={p} value={p}>{p}</option>)}
              <option value="OTHER_PLACE">Other Place</option>
            </select>
            {isOtherPlace && (
              <>
                <input type="text" id="create-customPlace" required value={customPlace}
                  onChange={(e) => setCustomPlace(e.target.value)}
                  placeholder="e.g. Sunshine West"
                  className="mt-2 block w-full rounded-md border-2 border-gray-400 bg-white px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500 dark:border-gray-500 dark:bg-gray-900 dark:text-white" />
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  Enter the suburb or location name. It will be saved for future use.
                </p>
              </>
            )}
          </div>
          <div>
            <label htmlFor="create-time" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Time</label>
            <select id="create-time" required value={formState.time}
              onChange={(e) => setFormState((p) => ({ ...p, time: e.target.value }))}
              className={fieldClass}>
              <option value="">Select a time</option>
              {TIME_OPTIONS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="create-leader" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Leader</label>
            <select id="create-leader" required value={formState.leader}
              onChange={async (e) => {
                const v = e.target.value;
                if (v && formState.state) {
                  const mobile = await getLeaderMobile(formState.state, v);
                  setFormState((p) => ({ ...p, leader: v, mobile: mobile || '' }));
                } else {
                  setFormState((p) => ({ ...p, leader: '', mobile: '' }));
                }
              }}
              disabled={!formState.state || loadingLeaders}
              className={`${fieldClass} disabled:opacity-50`}>
              <option value="">{loadingLeaders ? 'Loading...' : 'Select a leader'}</option>
              {leaders.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="create-mobile" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Mobile (Optional)</label>
            <input id="create-mobile" type="tel" value={formState.mobile}
              onChange={(e) => setFormState((p) => ({ ...p, mobile: e.target.value }))}
              placeholder="Enter mobile number"
              className={fieldClass} />
          </div>
          <div>
            <label htmlFor="create-category" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Category</label>
            <select id="create-category" required value={formState.category}
              onChange={(e) => setFormState((p) => ({ ...p, category: e.target.value }))}
              className={fieldClass}>
              {categories.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
            </select>
          </div>
          <button type="submit" disabled={isSubmitting}
            className="w-full rounded-md bg-blue-600 px-4 py-2 text-base font-bold text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed border-2 border-gray-800 dark:border-gray-600">
            {isSubmitting ? 'Adding...' : 'Add Campaign'}
          </button>
        </form>
      </div>
    </div>
  );
}
