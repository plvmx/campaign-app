'use client';

/**
 * Public, unauthenticated Register Interest page — tick campaigns for the
 * current fortnight and register interest ("Yes I'm In" / "Tell Me More").
 * Not listed in middleware's PROTECTED_PREFIXES, so it's open by default
 * (see middleware.ts). Data comes from GET /api/public/register-interest;
 * submissions go through POST on the same route (service role — see that
 * route for why campaign_interest can't be written via the browser client
 * here, unlike the admin-only /admin/registered-interest listing screen).
 *
 * Deliberately does NOT use MobileLayout — that component resolves the
 * signed-in user's admin status and assumes a logged-in session.
 *
 * Split out of page.tsx (a Server Component, for its `metadata` export —
 * a 'use client' page can't export metadata) — see page.tsx.
 */
import { useEffect, useMemo, useState } from 'react';
import LoadingSpinner from '@/components/LoadingSpinner';
import { useCampaignDates } from '@/contexts/CampaignDatesContext';
import { AUSTRALIAN_STATES, type AustralianState } from '@/lib/constants';
import { formatFortnightDateRangeString } from '@/lib/campaignDates';
import { getErrorMessage } from '@/lib/errorUtils';
import type { AriseCampaign } from '@/lib/ariseLayout';
import type { RegisterInterestGetResponse } from '@/app/api/public/register-interest/route';
import CampaignCheckboxList from './components/CampaignCheckboxList';
import InterestSummaryModal from './components/InterestSummaryModal';

type CampaignInterestType = 'in' | 'more';

export default function RegisterInterestClient() {
  const { dates: campaignDates } = useCampaignDates();

  // Display-only — the GET response always covers the current fortnight
  // regardless of any params, so this just formats the same range for the
  // header text.
  const rangeText = useMemo(() => {
    if (!campaignDates) return null;
    return formatFortnightDateRangeString(campaignDates.upcomingCampaignStart);
  }, [campaignDates]);

  const [selectedState, setSelectedState] = useState<AustralianState | ''>('');

  const [firstName, setFirstName] = useState('');
  const [mobileNumber, setMobileNumber] = useState('');

  const [allCampaigns, setAllCampaigns] = useState<AriseCampaign[]>([]);
  const [isLoadingCampaigns, setIsLoadingCampaigns] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch('/api/public/register-interest');
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error || 'Failed to load campaign data');
        if (cancelled) return;
        setAllCampaigns((json as RegisterInterestGetResponse).campaigns);
      } catch (err) {
        if (!cancelled) setLoadError(getErrorMessage(err, 'Failed to load campaign data'));
      } finally {
        if (!cancelled) setIsLoadingCampaigns(false);
      }
    })();

    return () => { cancelled = true; };
  }, []);

  const campaigns = selectedState
    ? allCampaigns.filter(c => c.state === selectedState)
    : allCampaigns;

  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const toggleChecked = (id: string) => {
    setCheckedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  // Preserves the campaigns' existing date/state/place/time sort order for
  // the confirmation popup's list.
  const checkedCampaigns = campaigns.filter(c => checkedIds.has(c.id));

  // Ticked campaigns can go stale (e.g. a place drops out of view when the
  // state filter changes) — drop any checked id no longer in view.
  // setState is deferred through a resolved Promise to avoid synchronous setState
  // inside the effect body, matching the pattern used elsewhere in the app.
  useEffect(() => {
    Promise.resolve().then(() => {
      setCheckedIds(prev => {
        // Recomputed from the underlying sources (rather than closing over
        // the outer `campaigns` variable) so this effect's dependency array
        // can name the actual sources instead of a value that's a new
        // reference every render.
        const visible = selectedState ? allCampaigns.filter(c => c.state === selectedState) : allCampaigns;
        const visibleIds = new Set(visible.map(c => c.id));
        let changed = false;
        const next = new Set<string>();
        for (const id of prev) {
          if (visibleIds.has(id)) {
            next.add(id);
          } else {
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    });
  }, [allCampaigns, selectedState]);

  const [popupAction, setPopupAction] = useState<CampaignInterestType | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [isSubmittingInterest, setIsSubmittingInterest] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const openPopup = (action: CampaignInterestType) => {
    setValidationError(null);
    if (checkedIds.size === 0) {
      setValidationError('Tick at least one campaign below first.');
      return;
    }
    if (!firstName.trim()) {
      setValidationError('Please enter your first name.');
      return;
    }
    if (!mobileNumber.trim()) {
      setValidationError('Please enter your mobile number.');
      return;
    }
    setPopupAction(action);
  };

  const closePopup = () => {
    setPopupAction(null);
    setSubmitError(null);
  };

  const handleProceed = async () => {
    if (!popupAction) return;
    // checkedCampaigns can go stale between opening the popup and pressing
    // Proceed — re-check rather than silently "succeeding" with nothing sent.
    if (checkedCampaigns.length === 0) {
      setSubmitError('The selected campaign(s) are no longer available — please close this and tick again.');
      return;
    }
    setIsSubmittingInterest(true);
    setSubmitError(null);
    try {
      const res = await fetch('/api/public/register-interest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firstName: firstName.trim(),
          mobile: mobileNumber.trim(),
          interestType: popupAction,
          campaignIds: checkedCampaigns.map(c => c.id),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || 'Failed to register your interest');
      setCheckedIds(new Set());
      setPopupAction(null);
    } catch (err: unknown) {
      setSubmitError(getErrorMessage(err, 'Failed to register your interest'));
    } finally {
      setIsSubmittingInterest(false);
    }
  };

  return (
    <div className="flex h-[calc(100dvh-var(--pwa-banner-height,0px))] flex-col p-4">
      <div className="mb-3">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Upcoming AFJ Campaigns</h1>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
          All upcoming campaigns for this fortnight are listed below. To <strong className="font-bold">join a campaign</strong>, or to <strong className="font-bold">get more information</strong> please enter your first name and mobile phone number here, click on the campaign that you are interested in and then click on the green or orange button at the bottom of the page.
        </p>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <label className="flex-1 min-w-[8rem]">
          <span className="sr-only">First name</span>
          <input
            type="text"
            value={firstName}
            onChange={e => setFirstName(e.target.value)}
            placeholder="First name"
            className="w-full rounded-md border-2 border-gray-800 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:placeholder:text-gray-500"
          />
        </label>
        <label className="flex-1 min-w-[8rem]">
          <span className="sr-only">Mobile number</span>
          <input
            type="tel"
            value={mobileNumber}
            onChange={e => setMobileNumber(e.target.value)}
            placeholder="Mobile number"
            className="w-full rounded-md border-2 border-gray-800 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:placeholder:text-gray-500"
          />
        </label>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <select
          value={selectedState}
          onChange={e => setSelectedState(e.target.value as AustralianState | '')}
          className="rounded-md border-2 border-gray-800 bg-white px-3 py-2 text-sm font-bold text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
        >
          <option value="">All states</option>
          {AUSTRALIAN_STATES.map(state => (
            <option key={state} value={state}>{state}</option>
          ))}
        </select>
        {rangeText && (
          <span className="ml-2 text-sm font-medium text-gray-700 dark:text-gray-300">
            {rangeText}
          </span>
        )}
      </div>

      {loadError && (
        <div className="mb-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-900/20 dark:text-red-200">
          {loadError}
        </div>
      )}
      {validationError && (
        <div className="mb-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-900/20 dark:text-red-200">
          {validationError}
        </div>
      )}

      {/* Campaign lines box — the list scrolls inside here so the two
          buttons below always stay visible on screen. */}
      <div className="relative flex-1 overflow-hidden rounded-lg border-2 border-gray-800 dark:border-gray-600">
        {isLoadingCampaigns && (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-white/80 dark:bg-gray-900/80">
            <LoadingSpinner text="Loading campaigns…" />
          </div>
        )}
        <div className="h-full overflow-y-auto">
          <CampaignCheckboxList campaigns={campaigns} checkedIds={checkedIds} onToggle={toggleChecked} />
        </div>
      </div>

      {/* Bottom action buttons — outside the campaign lines box, stretching
          the full width of the screen. */}
      <div className="mt-3 flex shrink-0 gap-2">
        <button
          type="button"
          onClick={() => openPopup('in')}
          className="flex-1 rounded-md bg-green-600 px-4 py-3 text-base font-bold text-white hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 border-2 border-gray-800 dark:border-gray-600"
        >
          Yes I&apos;m In
        </button>
        <button
          type="button"
          onClick={() => openPopup('more')}
          className="flex-1 rounded-md bg-orange-500 px-4 py-3 text-base font-bold text-white hover:bg-orange-600 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:ring-offset-2 border-2 border-gray-800 dark:border-gray-600"
        >
          Tell Me More
        </button>
      </div>

      {popupAction && (
        <InterestSummaryModal
          campaigns={checkedCampaigns}
          onProceed={handleProceed}
          onCancel={closePopup}
          isSubmitting={isSubmittingInterest}
          error={submitError}
        />
      )}
    </div>
  );
}
