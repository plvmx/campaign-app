'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import MobileLayout from '@/components/MobileLayout';
import LoadingSpinner from '@/components/LoadingSpinner';
import { useUser } from '@/contexts/UserContext';
import {
  getCampaignReportsNeedingReview,
  updateCampaignReportDerivedFields,
  type CampaignReportForReview,
} from '@/lib/services/campaignReportsService';
import { getPlacesForState, getLeadersForState } from '@/lib/services/dropdownService';
import { getErrorMessage } from '@/lib/errorUtils';
import { AUSTRALIAN_STATES, type AustralianState } from '@/lib/constants';

// Matches lib/campaignReportMatcher.ts's SINCE date and the scope Peter
// confirmed for this pass — see docs/campaign-report/BRIEF.md.
const SINCE_DATE = '2026-05-06';

interface RowDraft {
  state: string;
  place: string;
  leader: string;
}

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

function draftFromRow(row: CampaignReportForReview): RowDraft {
  return {
    state: row.derived_state ?? '',
    place: row.derived_place ?? '',
    leader: row.derived_leader ?? '',
  };
}

export default function CampaignReportsCleanupPage() {
  const router = useRouter();
  const { user, isAdmin, isLoading: isUserLoading } = useUser();

  const [hasAccess, setHasAccess] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [rows, setRows] = useState<CampaignReportForReview[]>([]);
  const [drafts, setDrafts] = useState<Record<string, RowDraft>>({});
  const [saveStates, setSaveStates] = useState<Record<string, SaveState>>({});
  const [saveErrors, setSaveErrors] = useState<Record<string, string>>({});

  // Cache of place/leader options per state so switching between rows that
  // share a state doesn't re-fetch — dropdownService is the single source of
  // truth for these lists, this just avoids calling it once per row.
  const [placesByState, setPlacesByState] = useState<Record<string, string[]>>({});
  const [leadersByState, setLeadersByState] = useState<Record<string, string[]>>({});

  useEffect(() => {
    if (isUserLoading) return;
    if (!user) { router.push('/login'); return; }
    if (!isAdmin) {
      setLoadError('You do not have permission to access this page');
      return;
    }
    setHasAccess(true);
  }, [isUserLoading, user, isAdmin, router]);

  const loadRows = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const data = await getCampaignReportsNeedingReview(SINCE_DATE);
      setRows(data);
      const nextDrafts: Record<string, RowDraft> = {};
      for (const row of data) nextDrafts[row.id] = draftFromRow(row);
      setDrafts(nextDrafts);
      setSaveStates({});
      setSaveErrors({});
    } catch (err: unknown) {
      setLoadError(getErrorMessage(err, 'Error loading records'));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (hasAccess) loadRows();
  }, [hasAccess, loadRows]);

  const ensureOptionsForState = useCallback((state: string) => {
    if (!state) return;
    if (!(state in placesByState)) {
      setPlacesByState((prev) => ({ ...prev, [state]: [] })); // mark as loading so we don't double-fetch
      getPlacesForState(state).then((options) => {
        setPlacesByState((prev) => ({ ...prev, [state]: options.map((o) => o.place) }));
      });
    }
    if (!(state in leadersByState)) {
      setLeadersByState((prev) => ({ ...prev, [state]: [] }));
      getLeadersForState(state).then((leaders) => {
        setLeadersByState((prev) => ({ ...prev, [state]: leaders }));
      });
    }
  }, [placesByState, leadersByState]);

  // Pre-warm dropdown options for any row whose state is already resolved,
  // so the Place/Leader suggestions are ready as soon as the page loads.
  useEffect(() => {
    for (const draft of Object.values(drafts)) {
      if (draft.state) ensureOptionsForState(draft.state);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once per drafts load, ensureOptionsForState is idempotent
  }, [drafts]);

  const updateDraft = (id: string, field: keyof RowDraft, value: string) => {
    setDrafts((prev) => ({ ...prev, [id]: { ...prev[id], [field]: value } }));
    if (field === 'state' && value) ensureOptionsForState(value);
    setSaveStates((prev) => ({ ...prev, [id]: 'idle' }));
  };

  const saveRow = async (id: string) => {
    const draft = drafts[id];
    if (!draft) return;
    setSaveStates((prev) => ({ ...prev, [id]: 'saving' }));
    try {
      await updateCampaignReportDerivedFields(id, {
        derived_state: draft.state || null,
        derived_place: draft.place || null,
        derived_leader: draft.leader || null,
      });
      setSaveStates((prev) => ({ ...prev, [id]: 'saved' }));
      // Fully resolved rows drop out of view immediately — nothing more to
      // do for them. A row saved with a field still intentionally blank
      // (e.g. no real place name exists) stays visible so it's not lost,
      // but its saved values are kept so re-saving is a no-op.
      if (draft.state && draft.place && draft.leader) {
        setRows((prev) => prev.filter((r) => r.id !== id));
      }
    } catch (err: unknown) {
      setSaveStates((prev) => ({ ...prev, [id]: 'error' }));
      setSaveErrors((prev) => ({ ...prev, [id]: getErrorMessage(err, 'Failed to save') }));
    }
  };

  if (isUserLoading || (isLoading && hasAccess)) {
    return (
      <MobileLayout>
        <div className="flex min-h-screen items-center justify-center">
          <LoadingSpinner text="Loading records…" />
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
            <a
              href="/admin"
              className="mt-4 inline-block rounded-md bg-red-600 px-4 py-2 text-base font-bold text-white hover:bg-red-700 border-2 border-gray-800 dark:border-gray-600"
            >
              Go Back
            </a>
          </div>
        </div>
      </MobileLayout>
    );
  }

  return (
    <MobileLayout>
      <div className="p-4 pb-28">
        <div className="mb-6">
          <a href="/admin" className="mb-4 inline-block text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400">
            ← Back to Admin Panel
          </a>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            Campaign Report Cleanup
          </h1>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            Records submitted on/after {SINCE_DATE} where State, Place, or Leader couldn&apos;t be
            worked out automatically from the original text. Fill in what you can and save —
            fully-resolved records drop off this list.
          </p>
        </div>

        {loadError && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-800 dark:bg-red-900/20">
            <p className="text-sm text-red-600 dark:text-red-300">{loadError}</p>
          </div>
        )}

        <div className="mb-4 flex items-center justify-between">
          <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
            {rows.length} record{rows.length === 1 ? '' : 's'} remaining
          </p>
          <button
            type="button"
            onClick={loadRows}
            className="rounded-md border-2 border-gray-400 bg-white px-3 py-1.5 text-sm font-semibold text-gray-700 hover:bg-gray-50 dark:border-gray-500 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600"
          >
            Refresh
          </button>
        </div>

        {rows.length === 0 && !isLoading && (
          <div className="rounded-lg border-2 border-green-300 bg-green-50 p-6 text-center dark:border-green-700 dark:bg-green-900/20">
            <p className="text-base font-semibold text-green-800 dark:text-green-200">
              Nothing left to review 🎉
            </p>
          </div>
        )}

        <div className="space-y-4">
          {rows.map((row) => {
            const draft = drafts[row.id] ?? draftFromRow(row);
            const saveState = saveStates[row.id] ?? 'idle';
            const placeOptions = draft.state ? (placesByState[draft.state] ?? []) : [];
            const leaderOptions = draft.state ? (leadersByState[draft.state] ?? []) : [];
            const dateLabel = row.campaign_date || row.campaign_date_raw || '(no date)';

            return (
              <div
                key={row.id}
                className="rounded-lg border-2 border-gray-300 bg-white p-4 shadow-sm dark:border-gray-600 dark:bg-gray-800"
              >
                <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-gray-200 pb-2 dark:border-gray-700">
                  <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                    {dateLabel}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    Submitted {new Date(row.submitted_at).toLocaleDateString('en-AU')}
                  </p>
                </div>

                <div className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
                      Location (as submitted)
                    </p>
                    <p className="text-sm text-gray-800 dark:text-gray-200">{row.location_raw || '—'}</p>
                  </div>
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
                      Leader (as submitted)
                    </p>
                    <p className="text-sm text-gray-800 dark:text-gray-200">{row.leader_raw || '—'}</p>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-700 dark:text-gray-300">State</label>
                    <select
                      value={draft.state}
                      onChange={(e) => updateDraft(row.id, 'state', e.target.value)}
                      className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                    >
                      <option value="">— Select —</option>
                      {AUSTRALIAN_STATES.map((s: AustralianState) => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 dark:text-gray-300">Place</label>
                    <input
                      list={`places-${row.id}`}
                      value={draft.place}
                      onChange={(e) => updateDraft(row.id, 'place', e.target.value)}
                      disabled={!draft.state}
                      placeholder={draft.state ? 'Type or pick a place' : 'Select a state first'}
                      className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm disabled:bg-gray-100 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:disabled:bg-gray-800"
                    />
                    <datalist id={`places-${row.id}`}>
                      {placeOptions.map((p) => <option key={p} value={p} />)}
                    </datalist>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 dark:text-gray-300">Leader</label>
                    <input
                      list={`leaders-${row.id}`}
                      value={draft.leader}
                      onChange={(e) => updateDraft(row.id, 'leader', e.target.value)}
                      disabled={!draft.state}
                      placeholder={draft.state ? 'Type or pick a leader' : 'Select a state first'}
                      className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm disabled:bg-gray-100 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:disabled:bg-gray-800"
                    />
                    <datalist id={`leaders-${row.id}`}>
                      {leaderOptions.map((l) => <option key={l} value={l} />)}
                    </datalist>
                  </div>
                </div>

                <div className="mt-3 flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => saveRow(row.id)}
                    disabled={saveState === 'saving'}
                    className="rounded-md bg-blue-600 px-4 py-1.5 text-sm font-bold text-white hover:bg-blue-700 disabled:bg-gray-400 border-2 border-gray-800 dark:border-gray-600"
                  >
                    {saveState === 'saving' ? 'Saving…' : 'Save'}
                  </button>
                  {saveState === 'saved' && (
                    <span className="text-sm font-medium text-green-700 dark:text-green-400">✓ Saved</span>
                  )}
                  {saveState === 'error' && (
                    <span className="text-sm font-medium text-red-700 dark:text-red-400">
                      {saveErrors[row.id] || 'Failed to save'}
                    </span>
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
