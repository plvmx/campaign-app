'use client';
import { AUSTRALIAN_STATES } from '@/lib/constants';
import type { Campaign } from '@/lib/types';
import type { EditUpdates } from './types';
import { useCampaignForm } from './useCampaignForm';
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
  const {
    values, setValue,
    isOtherPlace, customPlace, setCustomPlace,
    places, leaders,
    isSubmitting, error,
    handleSubmit, handleStateChange, handleLeaderChange, handlePlaceChange,
  } = useCampaignForm({
    initialValues: {
      date: campaign.date || '',
      state: (campaign.state || '').toUpperCase().trim(),
      place: campaign.place || '',
      time: normalizeTimeValue(campaign.time || ''),
      leader: campaign.leader || '',
      mobile: campaign.mobile || '',
      category: campaign.category ?? 'TWOL',
      tl_ok: campaign.tl_ok || false,
      sr_ok: campaign.sr_ok || false,
    },
    onSubmit: async (v) => {
      await onSave(campaign.id, {
        date: v.date, state: v.state, place: v.place, time: v.time,
        leader: v.leader, mobile: v.mobile.trim() || null,
        category: v.category ?? 'TWOL', tl_ok: v.tl_ok, sr_ok: v.sr_ok,
      });
      // Component unmounts on success — parent clears editingId
    },
  });

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
          <input type="date" value={values.date}
            onChange={(e) => setValue('date', e.target.value)} className={inputClass} />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">State</label>
          <select value={values.state} onChange={(e) => handleStateChange(e.target.value)}
            disabled={!isAdmin}
            className={`${inputClass} disabled:opacity-50 disabled:cursor-not-allowed`}>
            <option value="">Select state</option>
            {AUSTRALIAN_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Place</label>
          <select required={!isOtherPlace}
            value={isOtherPlace ? 'OTHER_PLACE' : values.place}
            onChange={(e) => handlePlaceChange(e.target.value)}
            disabled={!values.state}
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
          <select value={values.time}
            onChange={(e) => setValue('time', e.target.value)} className={inputClass}>
            <option value="">Select time</option>
            {TIME_OPTIONS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Leader</label>
          <select value={values.leader} onChange={(e) => handleLeaderChange(e.target.value)}
            disabled={!values.state}
            className={`${inputClass} disabled:opacity-50`}>
            <option value="">Select leader</option>
            {leaders.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
        </div>
        {isAdmin && (
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Mobile (Optional)</label>
            <input type="tel" value={values.mobile}
              onChange={(e) => setValue('mobile', e.target.value)}
              placeholder="Enter mobile number" className={inputClass} />
          </div>
        )}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Category</label>
          <select value={values.category}
            onChange={(e) => setValue('category', e.target.value)} className={inputClass}>
            {categories.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
          </select>
        </div>
        <div className="flex gap-3 pt-2">
          <button onClick={handleSubmit} disabled={isSubmitting}
            className="flex-1 rounded-md bg-green-600 px-3 py-3 text-base font-bold text-white hover:bg-green-700 disabled:opacity-50 border-2 border-gray-800 dark:border-gray-600">
            {isSubmitting ? 'Saving...' : 'Save Changes'}
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
