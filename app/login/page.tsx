'use client';

import { useState, FormEvent, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { getSession, validateStateLeader, completeSignIn, type StateLeaderMatch } from '@/lib/auth';
import { getErrorMessage } from '@/lib/errorUtils';
import { trackEvent } from '@/lib/analytics';
import { useUser } from '@/contexts/UserContext';
import { getRecentTWOLCampaignsForLeader } from '@/lib/services/campaignService';
import type { Campaign } from '@/lib/types';

type ActionChoice = 'record-past' | 'review-upcoming' | 'create-new' | 'campaign-rules';

const STORAGE_KEYS = { mobile: 'login_mobile', firstName: 'login_firstName' };

const STATE_NAMES: Record<string, string> = {
  ACT: 'Australian Capital Territory',
  NSW: 'New South Wales',
  NT:  'Northern Territory',
  QLD: 'Queensland',
  SA:  'South Australia',
  TAS: 'Tasmania',
  VIC: 'Victoria',
  WA:  'Western Australia',
};

export default function LoginPage() {
  const router = useRouter();
  const { refresh: refreshUser } = useUser();
  const [mobile, setMobile]           = useState('');
  const [firstName, setFirstName]     = useState('');
  const [error, setError]             = useState<string | null>(null);
  const [isLoading, setIsLoading]     = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);
  // Set when credentials validate but the leader has records in multiple states
  const [pendingMatches, setPendingMatches] = useState<StateLeaderMatch[] | null>(null);
  // Tracks which state button was clicked while sign-in is in progress
  const [selectedStateId, setSelectedStateId] = useState<string | null>(null);
  // Recent TWOL campaigns that the leader may want to record results for
  const [recentCampaigns, setRecentCampaigns] = useState<Pick<Campaign, 'id' | 'date' | 'state' | 'place' | 'time' | 'leader'>[] | null>(null);
  // Whether to show the post-sign-in action chooser (regular leaders only)
  const [showActionChooser, setShowActionChooser] = useState(false);

  // Check if user is already signed in
  useEffect(() => {
    async function checkExistingSession() {
      try {
        const session = await getSession();
        if (session) {
          router.push('/app');
          return;
        }
      } catch {
        // No session — continue to login form
      } finally {
        setCheckingSession(false);
      }
    }
    checkExistingSession();
  }, [router]);

  // Load remembered credentials from localStorage
  useEffect(() => {
    if (checkingSession) return;
    try {
      const savedMobile    = localStorage.getItem(STORAGE_KEYS.mobile);
      const savedFirstName = localStorage.getItem(STORAGE_KEYS.firstName);
      if (savedMobile)    setMobile(savedMobile);
      if (savedFirstName) setFirstName(savedFirstName);
    } catch {
      // Ignore localStorage errors (e.g. private browsing)
    }
  }, [checkingSession]);

  // ── Step 1: validate credentials ──────────────────────────────────────────
  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);

    try {
      if (!mobile.trim() || !firstName.trim()) {
        setError('Please enter both mobile number and first name');
        return;
      }

      const matches = await validateStateLeader(mobile.trim(), firstName.trim());

      if (matches.length === 0) {
        setError('No matching record found. Please check your mobile number and first name.');
        return;
      }

      // Save credentials now that they are confirmed valid
      try {
        localStorage.setItem(STORAGE_KEYS.mobile,    mobile.trim());
        localStorage.setItem(STORAGE_KEYS.firstName, firstName.trim());
      } catch { /* ignore */ }

      if (matches.length === 1) {
        // Single state — sign in immediately, no extra step
        await completeSignIn(matches[0]);
        // Reload the UserContext so it reads the profile that was just written
        // (avoids a race where onAuthStateChange fires before the profile upsert completes)
        await refreshUser();
        trackEvent('sign_in', { state: matches[0].state });
        await checkRecentCampaign(matches[0]);
      } else {
        // Multiple states — show state picker
        setPendingMatches(matches);
      }
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Failed to authenticate. Please check your mobile number and first name.'));
    } finally {
      setIsLoading(false);
    }
  };

  // ── Post-sign-in: show action chooser for regular leaders, or check recent TWOL for admins ─
  const checkRecentCampaign = async (match: StateLeaderMatch) => {
    if (!match.admin) {
      // Regular leader — show the action chooser instead of navigating
      setShowActionChooser(true);
      return;
    }
    try {
      const recent = await getRecentTWOLCampaignsForLeader(match.leader);
      if (recent.length > 0) {
        setRecentCampaigns(recent);
        return;
      }
    } catch {
      // Non-fatal — fall through to normal navigation
    }
    router.push('/app');
  };

  const handleActionChoice = (choice: ActionChoice) => {
    switch (choice) {
      case 'record-past':
        router.push('/app?filter=past');
        break;
      case 'review-upcoming':
        router.push('/app');
        break;
      case 'create-new':
        router.push('/app?openForm=true');
        break;
      case 'campaign-rules':
        router.push('/admin/campaign-rules');
        break;
    }
  };

  // ── Step 2 (multi-state only): complete sign-in with chosen state ─────────
  const handleStateSelect = async (match: StateLeaderMatch) => {
    setError(null);
    setIsLoading(true);
    setSelectedStateId(match.id);
    try {
      await completeSignIn(match);
      await refreshUser();
      trackEvent('sign_in', { state: match.state });
      await checkRecentCampaign(match);
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Failed to sign in. Please try again.'));
      setPendingMatches(null);
      setSelectedStateId(null);
    } finally {
      setIsLoading(false);
    }
  };

  // ── Loading / session-check spinner ──────────────────────────────────────
  if (checkingSession) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="text-gray-600 dark:text-gray-400">Checking sign-in status…</div>
      </div>
    );
  }

  const cardClass =
    'w-full max-w-md space-y-6 rounded-lg border-2 border-gray-800 dark:border-gray-600 bg-blue-50 p-6 shadow-lg dark:bg-blue-900/20 sm:p-8';

  // ── Recent-campaigns modal ────────────────────────────────────────────────
  function formatCampaignLabel(date: string, time: string, place: string): string {
    const d = new Date(`${date}T00:00:00`);
    const day = d.getDate();
    const suffix = day >= 11 && day <= 13 ? 'th' : ['th','st','nd','rd'][day % 10] ?? 'th';
    const month = ['January','February','March','April','May','June','July','August','September','October','November','December'][d.getMonth()];
    const [hStr, mStr] = time.split(':');
    const h = parseInt(hStr, 10);
    const ampm = h >= 12 ? 'pm' : 'am';
    const h12 = h % 12 || 12;
    const formattedTime = `${h12}:${mStr} ${ampm}`;
    return `${place} ${day}${suffix} ${month} ${formattedTime} ... Yes?`;
  }

  if (showActionChooser) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4 py-8 dark:bg-gray-900">
        <div className={cardClass}>
          <div className="space-y-6">
            <h2 className="text-center text-xl font-bold text-gray-900 dark:text-gray-100">
              What do you want to do today?
            </h2>
            <p className="text-center text-base text-gray-600 dark:text-gray-400">
              Please select an option.
            </p>
            <div className="flex flex-col gap-3">
              <button
                onClick={() => handleActionChoice('record-past')}
                className="w-full rounded-md bg-orange-600 px-4 py-3 text-base font-bold text-white hover:bg-orange-700 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:ring-offset-2 border-2 border-gray-800 dark:border-gray-600"
              >
                Record Results for Past Campaigns
              </button>
              <button
                onClick={() => handleActionChoice('review-upcoming')}
                className="w-full rounded-md bg-blue-600 px-4 py-3 text-base font-bold text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 border-2 border-gray-800 dark:border-gray-600"
              >
                Review or Update Upcoming Campaigns
              </button>
              <button
                onClick={() => handleActionChoice('create-new')}
                className="w-full rounded-md bg-green-600 px-4 py-3 text-base font-bold text-white hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 border-2 border-gray-800 dark:border-gray-600"
              >
                Create a New Campaign
              </button>
              <button
                onClick={() => handleActionChoice('campaign-rules')}
                className="w-full rounded-md bg-purple-600 px-4 py-3 text-base font-bold text-white hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 border-2 border-gray-800 dark:border-gray-600"
              >
                Create or Update a Campaign Rule
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (recentCampaigns) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4 py-8 dark:bg-gray-900">
        <div className={cardClass}>
          <div className="space-y-6">
            <h2 className="text-center text-xl font-bold text-gray-900 dark:text-gray-100">
              Do you want to Record Results for
            </h2>
            <div className="flex flex-col gap-3">
              {recentCampaigns.map(campaign => {
                const detailParams = new URLSearchParams({
                  id:     campaign.id,
                  date:   campaign.date,
                  state:  campaign.state,
                  place:  campaign.place,
                  time:   campaign.time,
                  leader: campaign.leader,
                });
                return (
                  <button
                    key={campaign.id}
                    onClick={() => router.push(`/record-results/detail?${detailParams.toString()}`)}
                    className="w-full rounded-md bg-green-600 px-4 py-3 text-base font-bold text-white hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 border-2 border-gray-800 dark:border-gray-600"
                  >
                    {formatCampaignLabel(campaign.date, campaign.time, campaign.place)}
                  </button>
                );
              })}
              <button
                autoFocus
                onClick={() => router.push('/app')}
                className="w-full rounded-md bg-red-600 px-4 py-3 text-base font-bold text-white hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 border-2 border-gray-800 dark:border-gray-600"
              >
                No
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4 py-8 dark:bg-gray-900">
      <div className={cardClass}>

        {/* Logo + title (always shown) */}
        <div className="flex flex-col items-center">
          <div className="mb-4 flex justify-center">
            <Image
              src="/afj_graphic.png"
              alt="AFJ Graphic"
              width={200}
              height={200}
              className="h-auto w-auto max-w-full"
              priority
            />
          </div>
          <h2 className="text-center text-2xl font-bold text-gray-900 dark:text-gray-100">
            AFJ Campaign Activity System
          </h2>
        </div>

        {/* Error banner */}
        {error && (
          <div className="rounded-md bg-red-50 p-3 text-sm text-red-800 dark:bg-red-900/20 dark:text-red-200">
            {error}
          </div>
        )}

        {/* ── State picker (step 2) ── */}
        {pendingMatches ? (
          <div className="space-y-4">
            <div>
              <p className="text-center text-sm font-semibold text-gray-700 dark:text-gray-300">
                You lead campaigns in multiple states.
              </p>
              <p className="mt-1 text-center text-sm text-gray-600 dark:text-gray-400">
                Which state are you working in today?
              </p>
            </div>

            <div className="flex flex-col gap-3">
              {pendingMatches.map(match => {
                const isSelected = selectedStateId === match.id;
                const isOther    = isLoading && !isSelected;
                return (
                  <button
                    key={match.id}
                    onClick={() => handleStateSelect(match)}
                    disabled={isLoading}
                    className={[
                      'w-full rounded-md px-4 py-3 text-base font-bold text-white',
                      'focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2',
                      'border-2 border-gray-800 dark:border-gray-600',
                      'disabled:cursor-not-allowed',
                      isSelected
                        ? 'bg-blue-600 opacity-75'   // selected: stays blue, slightly dimmed
                        : isOther
                          ? 'bg-gray-400'             // others: greyed out while one is loading
                          : 'bg-blue-600 hover:bg-blue-700', // normal state
                    ].join(' ')}
                  >
                    {match.state}
                    {STATE_NAMES[match.state] && (
                      <span className="ml-2 text-sm font-normal opacity-90">
                        — {STATE_NAMES[match.state]}
                      </span>
                    )}
                    {isSelected && (
                      <span className="ml-2 text-sm font-normal opacity-90">Signing in…</span>
                    )}
                  </button>
                );
              })}
            </div>

            <button
              onClick={() => { setPendingMatches(null); setError(null); }}
              disabled={isLoading}
              className="w-full text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400 disabled:opacity-50"
            >
              ← Back
            </button>
          </div>
        ) : (

        /* ── Credentials form (step 1) ── */
          <form onSubmit={handleSubmit} className="mt-2 space-y-6">
            <p className="text-center text-sm text-gray-600 dark:text-gray-400">
              Enter your mobile number and first name<br />to sign in
            </p>

            <div>
              <label
                htmlFor="mobile"
                className="block text-sm font-medium text-gray-700 dark:text-gray-300"
              >
                Mobile Number
              </label>
              <input
                id="mobile"
                name="mobile"
                type="tel"
                autoComplete="tel"
                required
                value={mobile}
                onChange={e => setMobile(e.target.value)}
                className="mt-1 block w-full rounded-md border-2 border-gray-400 bg-white px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500 dark:border-gray-500 dark:bg-gray-900 dark:text-white"
                placeholder="e.g., 0429 028 464"
                inputMode="tel"
              />
            </div>

            <div>
              <label
                htmlFor="firstName"
                className="block text-sm font-medium text-gray-700 dark:text-gray-300"
              >
                First Name
              </label>
              <input
                id="firstName"
                name="firstName"
                type="text"
                autoComplete="given-name"
                required
                value={firstName}
                onChange={e => setFirstName(e.target.value)}
                className="mt-1 block w-full rounded-md border-2 border-gray-400 bg-white px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500 dark:border-gray-500 dark:bg-gray-900 dark:text-white"
                placeholder="Enter your first name"
              />
            </div>

            <div>
              <button
                type="submit"
                disabled={isLoading}
                className="w-full rounded-md bg-blue-600 px-4 py-2 text-base font-bold text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed border-2 border-gray-800 dark:border-gray-600"
              >
                {isLoading ? 'Signing in...' : 'Sign In'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
