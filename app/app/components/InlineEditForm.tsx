'use client';
import { useState, useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { getPlacesForState, getLeadersForState, getLeaderMobile } from '@/lib/services/dropdownService';
import { getErrorMessage } from '@/lib/errorUtils';
import { AUSTRALIAN_STATES } from '@/lib/constants';
import type { Campaign } from '@/lib/types';
import type { EditUpdates } from './types';
import { TIME_OPTIONS, normalizeTimeValue } from './timeOptions';

interface Props {
  campaign: Campaign;
  isAdmin: boolean;
  categories: { code: string; name: string }[];
  onSave: (id: string, updates: EditUpdates) => Promise<void>;
  onCancel: () => void;
}

const inputClass =
  'w-full rounded-md border-2 border-gray-400 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500 dark:border-gray-500 dark:bg-gray-900 dark:text-white';

export default function InlineEditForm({ campaign, isAdmin, categories, onSave, onCancel }: Props) {
  const [editData, setEditData] = useState({
    date: campaign.date || '',
    state: (campaign.state || '').toUpperCase().trim(),
    place: campaign.place || '',
    time: normalizeTimeValue(campaign.time || ''),
    leader: campaign.leader || '',
    mobile: campaign.mobile || '',
    category: campaign.category ?? 'TWOL',
    tl_ok: campaign.tl_ok || false,
    sr_ok: campaign.sr_ok || false,
  });
  const [isOtherPlace, setIsOtherPlace] = useState(false);
  const [customPlace, setCustomPlace] = useState('');
  const [places, setPlaces] = useState<string[]>([]);
  const [leaders, setLeaders] = useState<string[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const placesCache = useRef<Record<string, string[]>>({});
  const leadersCache = useRef<Record<string, string[]>>({});

  useEffect(() => {
    if (!editData.state) { setPlaces([]); return; }
    const s = editData.state.toUpperCase().trim();
    if (placesCache.current[s]) { setPlaces(placesCache.current[s]); return; }
    getPlacesForState(s).then((p) => { placesCache.current[s] = p; setPlaces(p); });
  }, [editData.state]);

  useEffect(() => {
    if (!editData.state) { setLeaders([]); return; }
    const s = editData.state.toUpperCase().trim();
    if (leadersCache.current[s]) { setLeaders(leadersCache.current[s]); return; }
    getLeadersForState(s).then((l) => { leadersCache.current[s] = l; setLeaders(l); });
  }, [editData.state]);

  const handleStateChange = (value: string) => {
    setIsOtherPlace(false);
    setCustomPlace('');
    setEditData((p) => ({ ...p, state: value, place: '', leader: '', mobile: '' }));
  };

  const handleLeaderChange = async (value: string) => {
    if (value && editData.state) {
      const mobile = await getLeaderMobile(editData.state, value);
      setEditData((p) => ({ ...p, leader: value, mobile: mobile || '' }));
    } else {
      setEditData((p) => ({ ...p, leader: '', mobile: '' }));
    }
  };

  const handleSave = async () => {
    setError(null);
    setIsSaving(true);
    try {
      let placeValue = editData.place;
      if (isOtherPlace && customPlace.trim()) {
        if (!editData.state?.trim()) throw new Error('Please select a state before entering a new place');
        const newPlace = customPlace.trim();
        const stateValue = editData.state.toUpperCase().trim();
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
      await onSave(campaign.id, {
        date: editData.date,
        state: editData.state,
        place: placeValue,
        time: editData.time,
        leader: editData.leader,
        mobile: editData.mobile.trim() || null,
        category: editData.category ?? 'TWOL',
        tl_ok: editData.tl_ok,
        sr_ok: editData.sr_ok,
      });
      // Component unmounts on success — parent clears editingId
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Failed to update campaign'));
      setIsSaving(false);
    }
  };

  return (
    <div className="p-4 bg-blue-50 dark:bg-blue-900/20 border-b-2 border-gray-800 dark:border-gray-600">
      {error && (
        <div className="mb-3 rounded-md bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-800 dark:bg-red-900/20 dark:border-red-800 dark:text-red-200">
          {error}
        </div>
      )}
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Date</label>
          <input type="date" value={editData.date}
            onChange={(e) => setEditData((p) => ({ ...p, date: e.target.value }))}
            className={inputClass} />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">State</label>
          <select value={editData.state} onChange={(e) => handleStateChange(e.target.value)}
            disabled={!isAdmin}
            className={`${inputClass} disabled:opacity-50 disabled:cursor-not-allowed`}>
            <option value="">Select state</option>
            {AUSTRALIAN_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Place</label>
          <select required={!isOtherPlace}
            value={isOtherPlace ? 'OTHER_PLACE' : editData.place}
            onChange={(e) => {
              if (e.target.value === 'OTHER_PLACE') {
                setIsOtherPlace(true);
                setEditData((p) => ({ ...p, place: '' }));
              } else {
                setIsOtherPlace(false);
                setCustomPlace('');
                setEditData((p) => ({ ...p, place: e.target.value }));
              }
            }}
            disabled={!editData.state}
            className={`${inputClass} disabled:opacity-50`}>
            <option value="">Select place</option>
            {places.map((p) => <option key={p} value={p}>{p}</option>)}
            <option value="OTHER_PLACE">Other Place</option>
          </select>
          {isOtherPlace && (
            <>
              <input type="text" required value={customPlace}
                onChange={(e) => setCustomPlace(e.target.value)}
                placeholder="e.g. Sunshine West"
                className={`mt-2 ${inputClass}`} />
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                Enter the suburb or location name. It will be saved for future use.
              </p>
            </>
          )}
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Time</label>
          <select value={editData.time}
            onChange={(e) => setEditData((p) => ({ ...p, time: e.target.value }))}
            className={inputClass}>
            <option value="">Select time</option>
            {TIME_OPTIONS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Leader</label>
          <select value={editData.leader} onChange={(e) => handleLeaderChange(e.target.value)}
            disabled={!editData.state}
            className={`${inputClass} disabled:opacity-50`}>
            <option value="">Select leader</option>
            {leaders.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
        </div>
        {isAdmin && (
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Mobile (Optional)</label>
            <input type="tel" value={editData.mobile}
              onChange={(e) => setEditData((p) => ({ ...p, mobile: e.target.value }))}
              placeholder="Enter mobile number"
              className={inputClass} />
          </div>
        )}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Category</label>
          <select value={editData.category}
            onChange={(e) => setEditData((p) => ({ ...p, category: e.target.value }))}
            className={inputClass}>
            {categories.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
          </select>
        </div>
        <div className="flex gap-3 pt-2">
          <button onClick={handleSave} disabled={isSaving}
            className="flex-1 rounded-md bg-green-600 px-3 py-3 text-base font-bold text-white hover:bg-green-700 disabled:opacity-50 border-2 border-gray-800 dark:border-gray-600">
            {isSaving ? 'Saving...' : 'Save Changes'}
          </button>
          <button onClick={onCancel}
            className="flex-1 rounded-md bg-gray-200 px-3 py-3 text-base font-bold text-gray-700 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600 border-2 border-gray-800 dark:border-gray-600">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
