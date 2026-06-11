'use client';
import { createCampaign } from '@/lib/services/campaignService';
import { trackEvent } from '@/lib/analytics';
import { getTodayDateString } from '@/lib/campaignDates';
import { AUSTRALIAN_STATES } from '@/lib/constants';
import { useCampaignForm } from './useCampaignForm';
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
  const {
    values, setValue,
    isOtherPlace, customPlace, setCustomPlace,
    places, leaders, loadingPlaces, loadingLeaders,
    isSubmitting, error,
    handleSubmit, handleStateChange, handleLeaderChange, handlePlaceChange,
  } = useCampaignForm({
    initialValues: {
      date: getTodayDateString(),
      state: userState ? userState.toUpperCase().trim() : '',
      place: '', time: '', leader: '', mobile: '',
      category: 'TWOL', tl_ok: false, sr_ok: false,
    },
    onSubmit: async (v) => {
      await createCampaign({
        date: v.date, state: v.state, place: v.place, time: v.time,
        leader: v.leader, mobile: v.mobile.trim() || null,
        category: v.category ?? 'TWOL', tl_ok: v.tl_ok, sr_ok: v.sr_ok,
        user_id: userId, source: 'MAN',
      });
      trackEvent('campaign_create', { state: v.state, category: v.category ?? 'TWOL' });
      onSuccess();
      onClose();
    },
    autoFill: { isAdmin, userMobileAndLeader, userState },
  });

  return (
    <div className="rounded-lg border-2 border-gray-800 dark:border-gray-600 bg-white shadow-sm dark:bg-gray-800 w-full overflow-hidden">
      <div className="flex items-center justify-between p-4">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Add Campaign</h2>
        <button type="button" onClick={onClose}
          className="rounded-md bg-red-600 px-3 py-1 text-base font-bold text-white hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 border-2 border-gray-800 dark:border-gray-600">
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
            <input type="date" id="create-date" required value={values.date}
              onChange={(e) => setValue('date', e.target.value)} className={fieldClass} />
          </div>
          <div>
            <label htmlFor="create-state" className="block text-sm font-medium text-gray-700 dark:text-gray-300">State</label>
            <select id="create-state" required value={values.state}
              onChange={(e) => handleStateChange(e.target.value)}
              disabled={!isAdmin}
              className={`${fieldClass} disabled:opacity-50 disabled:cursor-not-allowed`}>
              <option value="">Select a state</option>
              {AUSTRALIAN_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="create-place" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Place</label>
            <select id="create-place" required={!isOtherPlace}
              value={isOtherPlace ? 'OTHER_PLACE' : values.place}
              onChange={(e) => handlePlaceChange(e.target.value)}
              disabled={!values.state || loadingPlaces}
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
            <select id="create-time" required value={values.time}
              onChange={(e) => setValue('time', e.target.value)} className={fieldClass}>
              <option value="">Select a time</option>
              {TIME_OPTIONS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="create-leader" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Leader</label>
            <select id="create-leader" required value={values.leader}
              onChange={(e) => handleLeaderChange(e.target.value)}
              disabled={!values.state || loadingLeaders}
              className={`${fieldClass} disabled:opacity-50`}>
              <option value="">{loadingLeaders ? 'Loading...' : 'Select a leader'}</option>
              {leaders.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="create-mobile" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Mobile (Optional)</label>
            <input id="create-mobile" type="tel" value={values.mobile}
              onChange={(e) => setValue('mobile', e.target.value)}
              placeholder="Enter mobile number" className={fieldClass} />
          </div>
          <div>
            <label htmlFor="create-category" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Category</label>
            <select id="create-category" required value={values.category}
              onChange={(e) => setValue('category', e.target.value)} className={fieldClass}>
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
