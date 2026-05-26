'use client';

import { useEffect, useState, useMemo, useCallback, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import MobileLayout from '@/components/MobileLayout';
import LoadingSpinner from '@/components/LoadingSpinner';
import { supabase } from '@/lib/supabaseClient';
import { normalizeName, normalizeMobile } from '@/lib/auth';
import { useUser, upsertUserProfile } from '@/contexts/UserContext';
import { fetchCampaignData } from '@/lib/campaignLog';
import { getSharedWithMeOwners } from '@/lib/leaderShares';
import { getErrorMessage } from '@/lib/errorUtils';
import type { Campaign, LeaderShareOwner } from '@/lib/types';
import { deleteCampaign, updateCampaign } from '@/lib/services/campaignService';
import { trackEvent } from '@/lib/analytics';
import { getCampaignCategories } from '@/lib/services/dropdownService';
import { getUserStateCode } from '@/lib/location';
import { getUserAdminStatusAndMobile } from '@/lib/campaignFilter';

import AdminQuickActions from './components/AdminQuickActions';
import CampaignFilters from './components/CampaignFilters';
import CampaignCreateForm from './components/CampaignCreateForm';
import CampaignList from './components/CampaignList';
import CampaignSlideView from './components/CampaignSlideView';
import DeleteConfirmModal from './components/DeleteConfirmModal';
import type { EditUpdates } from './components/types';

function AppPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const {
    user: contextUser,
    userProfile: contextUserProfile,
    isAdmin: contextIsAdmin,
    adminStatus: contextAdminStatus,
    userState: contextUserState,
    userLeader: contextUserLeader,
    userMobile: contextUserMobile,
    isLoading: isUserLoading,
    updateProfile: updateContextProfile,
  } = useUser();

  // Auth / role state — local copies kept in sync after each refetch
  const [isLoading, setIsLoading] = useState(true);
  const [adminStatus, setAdminStatus] = useState<string | null>(null);
  const [userState, setUserState] = useState<string | null>(null);
  const [userMobileAndLeader, setUserMobileAndLeader] = useState<{
    mobile: string | null;
    leader: string | null;
  } | null>(null);
  const [sharedWithMeOwners, setSharedWithMeOwners] = useState<LeaderShareOwner[]>([]);

  const [showMoreInfo, setShowMoreInfo] = useState(false);
  const [viewMode, setViewMode] = useState<'view' | 'edit'>('view');
  const [allCampaigns, setAllCampaigns] = useState<Campaign[]>([]);
  const [campaignCategories, setCampaignCategories] = useState<{ code: string; name: string }[]>([
    { code: 'TWOL', name: 'Two Weekly' },
    { code: 'BOTJ', name: 'Book of the Judgement' },
    { code: 'TLT', name: 'TLT' },
  ]);

  // UI filter state
  const [filterState, setFilterState] = useState('');
  const [filterPlace, setFilterPlace] = useState('');
  const [filterLeader, setFilterLeader] = useState('');
  const [filterMobile, setFilterMobile] = useState('');
  const [dateFilter, setDateFilter] = useState<'past' | 'future'>('future');

  // UI feedback state
  const [isFormExpanded, setIsFormExpanded] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Edit / delete state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteConfirmCampaign, setDeleteConfirmCampaign] = useState<Campaign | null>(null);
  const [savedCheckboxId, setSavedCheckboxId] = useState<string | null>(null);

  // -------------------------------------------------------------------------
  // Derived data
  // -------------------------------------------------------------------------

  const applyDateFilter = useCallback(
    (items: Campaign[]) => {
      const now = new Date();
      return items.filter((campaign) => {
        let timeStr = campaign.time;
        if (timeStr.includes('T')) timeStr = timeStr.split('T')[1]?.split('.')[0] || timeStr;
        const [hours, minutes] = timeStr.split(':').map(Number);
        const dt = new Date(campaign.date);
        dt.setHours(hours || 0, minutes || 0, 0, 0);
        return dateFilter === 'past' ? dt < now : dt > now;
      });
    },
    [dateFilter],
  );

  const dateFilteredForOptions = useMemo(
    () => applyDateFilter(allCampaigns),
    [allCampaigns, applyDateFilter],
  );

  const stateFilteredForOptions = useMemo(() => {
    if (!filterState) return dateFilteredForOptions;
    return dateFilteredForOptions.filter(
      (c) => c.state.toUpperCase() === filterState.toUpperCase(),
    );
  }, [dateFilteredForOptions, filterState]);

  const filterPlaceOptions = useMemo(
    () => [...new Set(stateFilteredForOptions.map((c) => c.place ?? '').filter(Boolean))].sort(),
    [stateFilteredForOptions],
  );
  const filterLeaderOptions = useMemo(
    () => [...new Set(stateFilteredForOptions.map((c) => c.leader ?? '').filter(Boolean))].sort(),
    [stateFilteredForOptions],
  );
  const filterMobileOptions = useMemo(
    () => [...new Set(stateFilteredForOptions.map((c) => c.mobile ?? '').filter(Boolean))].sort(),
    [stateFilteredForOptions],
  );

  const filteredCampaigns = useMemo(() => {
    if (allCampaigns.length === 0) return [];
    let filtered = allCampaigns;
    if (filterState) filtered = filtered.filter((c) => c.state.toUpperCase() === filterState.toUpperCase());
    if (filterPlace) filtered = filtered.filter((c) => (c.place ?? '').toLowerCase().includes(filterPlace.toLowerCase()));
    if (filterLeader) filtered = filtered.filter((c) => (c.leader ?? '').toLowerCase().includes(filterLeader.toLowerCase()));
    if (filterMobile) filtered = filtered.filter((c) => (c.mobile ?? '').replace(/\s/g, '').includes(filterMobile.replace(/\s/g, '')));
    return applyDateFilter(filtered);
  }, [allCampaigns, filterState, filterPlace, filterLeader, filterMobile, applyDateFilter]);

  // -------------------------------------------------------------------------
  // Data fetching
  // -------------------------------------------------------------------------

  const refetchCampaigns = useCallback(async () => {
    if (!contextUser) return;

    const { admin: adminStatusValue, state: userStateValue, mobile, leader } =
      await getUserAdminStatusAndMobile();

    setAdminStatus(adminStatusValue);
    setUserState(userStateValue);

    let sharedOwnersList: LeaderShareOwner[] = [];
    if (adminStatusValue !== 'AD' && adminStatusValue !== 'SR' && leader && userStateValue) {
      sharedOwnersList = await getSharedWithMeOwners(userStateValue, leader);
      setSharedWithMeOwners(sharedOwnersList);
    }

    let query = supabase.from('campaigns').select('*');
    if (adminStatusValue === 'AD') {
      // no filter — see all
    } else if (adminStatusValue === 'SR') {
      query = userStateValue
        ? query.eq('state', userStateValue.toUpperCase().trim())
        : query.eq('user_id', contextUser.id);
    } else {
      query = leader
        ? query.eq('leader', leader.trim())
        : query.eq('user_id', contextUser.id);
    }

    const { data, error: fetchError } = await query
      .order('date', { ascending: true })
      .order('state', { ascending: true })
      .order('place', { ascending: true })
      .order('time', { ascending: true });

    if (fetchError) throw fetchError;

    let dataMerged: Campaign[] = (data || []) as Campaign[];

    if (adminStatusValue !== 'AD' && adminStatusValue !== 'SR' && sharedOwnersList.length > 0) {
      const sharedResults = await Promise.all(
        sharedOwnersList.map((o) =>
          supabase
            .from('campaigns')
            .select('*')
            .eq('state', o.owner_state || '')
            .eq('leader', (o.owner_leader || '').trim())
            .order('date', { ascending: true })
            .order('state', { ascending: true })
            .order('place', { ascending: true })
            .order('time', { ascending: true }),
        ),
      );
      const ownIds = new Set(dataMerged.map((c) => c.id));
      for (const { data: sharedData, error: sharedError } of sharedResults) {
        if (!sharedError && sharedData?.length) {
          const extra = (sharedData as Campaign[]).filter((c) => !ownIds.has(c.id));
          extra.forEach((c) => ownIds.add(c.id));
          dataMerged = [...dataMerged, ...extra];
        }
      }
    }

    let filteredData = dataMerged;
    if (adminStatusValue !== 'AD' && adminStatusValue !== 'SR') {
      if (mobile && userStateValue) {
        const normalizedMobile = normalizeMobile(mobile);
        const isSharedCampaign = (c: Campaign) =>
          sharedOwnersList.some(
            (o) =>
              (o.owner_state || '').toUpperCase().trim() === (c.state || '').toUpperCase().trim() &&
              normalizeName(o.owner_leader) === normalizeName(c.leader || ''),
          );
        filteredData = dataMerged.filter(
          (c) =>
            isSharedCampaign(c) ||
            (!!c.mobile && normalizeMobile(c.mobile) === normalizedMobile),
        );
      }
    }

    setAllCampaigns(filteredData);
  }, [contextUser]);

  // -------------------------------------------------------------------------
  // Effects
  // -------------------------------------------------------------------------

  useEffect(() => {
    getCampaignCategories().then((cats) => {
      if (cats.length > 0) setCampaignCategories(cats);
    });
  }, []);

  useEffect(() => {
    if (isUserLoading) return;

    if (!contextUser) {
      router.push('/login');
      return;
    }

    async function initPage() {
      try {
        setAdminStatus(contextAdminStatus);
        setUserState(contextUserState);
        if (contextUserMobile && contextUserLeader) {
          setUserMobileAndLeader({ mobile: contextUserMobile, leader: contextUserLeader });
        }

        // First-login onboarding
        if (!contextUserProfile) {
          const pendingFirstName = sessionStorage.getItem('pendingFirstName');
          if (pendingFirstName) {
            try {
              let stateCode: string | null = null;
              try { const { stateCode: sc } = await getUserStateCode(); stateCode = sc; } catch {}
              const newProfile = await upsertUserProfile({ name: pendingFirstName, state: stateCode });
              updateContextProfile(newProfile);
              sessionStorage.removeItem('pendingFirstName');
            } catch (profileError) {
              console.error('Error creating user profile:', profileError);
            }
          }
        }

        // Handle URL params
        const filterParam = searchParams.get('filter');
        if (filterParam === 'past' || filterParam === 'future') {
          setDateFilter(filterParam as 'past' | 'future');
          router.replace('/app', { scroll: false });
        }
        if (searchParams.get('created') === 'true') {
          setShowSuccess(true);
          router.replace('/app', { scroll: false });
          setTimeout(() => setShowSuccess(false), 10000);
        }

        // Fetch campaigns
        let sharedOwnersList: LeaderShareOwner[] = [];
        let query = supabase.from('campaigns').select('*');

        if (contextAdminStatus === 'AD') {
          // no filter
        } else if (contextAdminStatus === 'SR') {
          query = contextUserState
            ? query.eq('state', contextUserState.toUpperCase().trim())
            : query.eq('user_id', contextUser!.id);
        } else {
          if (contextUserMobile && contextUserLeader) {
            sharedOwnersList = await getSharedWithMeOwners(contextUserState || '', contextUserLeader);
            setSharedWithMeOwners(sharedOwnersList);
            query = query.eq('leader', contextUserLeader);
          } else {
            query = query.eq('user_id', contextUser!.id);
          }
        }

        const { data, error } = await query
          .order('date', { ascending: true })
          .order('state', { ascending: true })
          .order('place', { ascending: true })
          .order('time', { ascending: true });

        if (error) throw error;

        let dataMerged: Campaign[] = (data || []) as Campaign[];

        if (contextAdminStatus !== 'AD' && contextAdminStatus !== 'SR' && sharedOwnersList.length > 0) {
          const sharedResults = await Promise.all(
            sharedOwnersList.map((o) =>
              supabase
                .from('campaigns')
                .select('*')
                .eq('state', o.owner_state || '')
                .eq('leader', (o.owner_leader || '').trim())
                .order('date', { ascending: true })
                .order('state', { ascending: true })
                .order('place', { ascending: true })
                .order('time', { ascending: true }),
            ),
          );
          const ownIds = new Set(dataMerged.map((c) => c.id));
          for (const { data: sharedData, error: sharedError } of sharedResults) {
            if (!sharedError && sharedData?.length) {
              const extra = (sharedData as Campaign[]).filter((c) => !ownIds.has(c.id));
              extra.forEach((c) => ownIds.add(c.id));
              dataMerged = [...dataMerged, ...extra];
            }
          }
        }

        let filteredData = dataMerged;
        if (contextAdminStatus !== 'AD' && contextAdminStatus !== 'SR') {
          if (contextUserMobile && contextUserState) {
            const normalizedMobile = normalizeMobile(contextUserMobile);
            const isSharedCampaign = (c: Campaign) =>
              sharedOwnersList.some(
                (o) =>
                  (o.owner_state || '').toUpperCase().trim() === (c.state || '').toUpperCase().trim() &&
                  normalizeName(o.owner_leader) === normalizeName(c.leader || ''),
              );
            filteredData = dataMerged.filter(
              (c) =>
                isSharedCampaign(c) ||
                (!!c.mobile && normalizeMobile(c.mobile) === normalizedMobile),
            );
          }
        }

        setAllCampaigns(filteredData);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const isAuthError =
          msg.toLowerCase().includes('auth') ||
          msg.toLowerCase().includes('session') ||
          msg.toLowerCase().includes('jwt');
        if (isAuthError) router.push('/login');
        else console.error('App page initialization error:', err);
      } finally {
        setIsLoading(false);
      }
    }

    initPage();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isUserLoading, contextUser]);

  useEffect(() => {
    if (adminStatus !== null && adminStatus !== 'AD' && adminStatus !== 'SR') {
      setShowMoreInfo(true);
    }
  }, [adminStatus]);

  // -------------------------------------------------------------------------
  // Handlers
  // -------------------------------------------------------------------------

  const handleSaveEdit = async (id: string, updates: EditUpdates) => {
    const oldData = await fetchCampaignData(id);
    await updateCampaign(id, updates, oldData);
    trackEvent('campaign_update', { state: updates.state });
    setSuccess('Campaign updated successfully');
    setEditingId(null);
    await refetchCampaigns();
  };

  const handleConfirmDelete = async () => {
    if (!deleteConfirmCampaign) return;
    const campaign = deleteConfirmCampaign;
    setDeleteConfirmCampaign(null);
    try {
      const oldData = await fetchCampaignData(campaign.id);
      await deleteCampaign(campaign.id, oldData);
      trackEvent('campaign_delete');
      setSuccess('Campaign deleted successfully');
      await refetchCampaigns();
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Failed to delete campaign'));
    }
  };

  const handleToggleCheckbox = async (
    campaignId: string,
    field: 'tl_ok' | 'sr_ok',
    currentValue: boolean,
  ) => {
    const newValue = !currentValue;
    const applyToRow = (val: boolean) => (c: Campaign) =>
      c.id === campaignId ? { ...c, [field]: val } : c;
    setAllCampaigns((prev) => prev.map(applyToRow(newValue)));
    try {
      const oldData = await fetchCampaignData(campaignId);
      await updateCampaign(campaignId, { [field]: newValue }, oldData);
      setSavedCheckboxId(campaignId);
      setTimeout(
        () => setSavedCheckboxId((prev) => (prev === campaignId ? null : prev)),
        2500,
      );
    } catch (err: unknown) {
      setAllCampaigns((prev) => prev.map(applyToRow(currentValue)));
      setError(getErrorMessage(err, 'Failed to update verification status'));
    }
  };

  const handleRecordResults = useCallback(
    (campaign: Campaign) => {
      const params = new URLSearchParams({
        id: campaign.id,
        date: campaign.date,
        state: campaign.state,
        place: campaign.place,
        time: campaign.time,
        leader: campaign.leader,
        returnFilter: dateFilter,
      });
      router.push(`/record-results/detail?${params.toString()}`);
    },
    [router, dateFilter],
  );

  const handleFilterChange = (
    field: 'state' | 'place' | 'leader' | 'mobile',
    value: string,
  ) => {
    if (field === 'state') {
      setFilterState(value);
      setFilterPlace('');
      setFilterLeader('');
      setFilterMobile('');
    } else if (field === 'place') setFilterPlace(value);
    else if (field === 'leader') setFilterLeader(value);
    else setFilterMobile(value);
  };

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  if (isUserLoading || isLoading) {
    return (
      <MobileLayout>
        <div className="flex min-h-screen items-center justify-center">
          <LoadingSpinner text="Loading your campaigns…" />
        </div>
      </MobileLayout>
    );
  }

  const displayName = contextUserProfile?.name
    ? contextUserProfile.name.includes('_')
      ? contextUserProfile.name.split('_')[0]
      : contextUserProfile.name
    : null;

  return (
    <MobileLayout>
      <div className="p-4 max-w-full overflow-x-hidden">

        {/* Welcome header */}
        <div className="mb-6">
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-gray-100 break-words">
            {displayName ? `Welcome back ${displayName}!` : 'Welcome back!'}
          </h1>
          <div className="mt-1">
            <p className="text-sm sm:text-base text-gray-600 dark:text-gray-400 break-words inline">
              {adminStatus === 'AD'
                ? 'You have signed in as an Administrator and can manage all campaign records and access all admin functions'
                : adminStatus === 'SR'
                ? 'You have signed in as a State Reporter and can manage all campaign records in your state'
                : 'You have signed in as a Team Leader and can manage all campaigns that you lead here'}
              {' '}
            </p>
            <button
              onClick={() => setShowMoreInfo(!showMoreInfo)}
              className="text-base font-bold text-blue-600 dark:text-blue-400 underline hover:text-blue-800 dark:hover:text-blue-300 focus:outline-none"
            >
              More Info
            </button>
            {showMoreInfo && (
              <div className="mt-2 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-md text-sm text-gray-700 dark:text-gray-300">
                {adminStatus === 'SR'
                  ? 'Please check all campaign details carefully. If any details are not correct use the Edit, Delete and Create buttons to make any changes necessary. When viewing Future campaigns, when you have finished please confirm by clicking on the "This Campaign is Correct" checkbox.'
                  : adminStatus !== 'AD'
                  ? 'As a team leader you can perform two main functions here. Firstly you can record results (names of persons that you and your team have presented the gospel to) by clicking on the "Record Results" button. Secondly you can check and confirm that all details relating to your upcoming campaigns are correct. If any details are not correct use the Edit, Delete and Create buttons to make any changes necessary. When viewing Future campaigns, when you have finished please confirm by clicking on the "This Campaign is Correct" checkbox.'
                  : 'More info to come soon'}
              </div>
            )}
          </div>

          {/* Campaign Rules shortcut — team leaders only */}
          {adminStatus !== 'AD' && adminStatus !== 'SR' && userState && (
            <div className="mt-4 rounded-lg border-2 border-green-300 bg-green-50 p-3 dark:border-green-700 dark:bg-green-900/20">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-green-700 dark:text-green-400">
                Campaign Rules
              </p>
              <p className="mb-3 text-sm text-green-800 dark:text-green-300">
                Set up recurring rules so your campaigns are created automatically each fortnight.
              </p>
              <button
                onClick={() => router.push('/admin/campaign-rules')}
                className="rounded-md bg-green-600 px-4 py-2 text-sm font-bold text-white hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 border-2 border-gray-800 dark:border-gray-600"
              >
                Manage Campaign Rules
              </button>
            </div>
          )}

          {/* Admin Quick Actions */}
          {contextAdminStatus === 'AD' && (
            <AdminQuickActions adminStatus={contextAdminStatus} userState={contextUserState} />
          )}

          {/* Date filter + Add Campaign */}
          <div className="mt-4 flex justify-center gap-3 flex-wrap items-center">
            <div className="inline-flex rounded-lg border-2 border-gray-800 dark:border-gray-600 overflow-hidden shadow-sm">
              <button
                onClick={() => setDateFilter('past')}
                className={`px-5 py-2 text-base font-bold transition-colors ${
                  dateFilter === 'past'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gradient-to-b from-gray-100 to-gray-200 text-gray-700 hover:from-gray-200 hover:to-gray-300 dark:from-gray-700 dark:to-gray-800 dark:text-gray-300 dark:hover:from-gray-600 dark:hover:to-gray-700'
                }`}
              >
                Past
              </button>
              <div className="w-px bg-gray-800 dark:bg-gray-600" />
              <button
                onClick={() => setDateFilter('future')}
                className={`px-5 py-2 text-base font-bold transition-colors ${
                  dateFilter === 'future'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gradient-to-b from-gray-100 to-gray-200 text-gray-700 hover:from-gray-200 hover:to-gray-300 dark:from-gray-700 dark:to-gray-800 dark:text-gray-300 dark:hover:from-gray-600 dark:hover:to-gray-700'
                }`}
              >
                Future
              </button>
            </div>
            <button
              onClick={() => setIsFormExpanded(!isFormExpanded)}
              className={`rounded-md px-4 py-2 text-base font-bold transition-colors shadow-sm border-2 border-gray-800 dark:border-gray-600 ${
                isFormExpanded
                  ? 'bg-green-600 text-white shadow-md'
                  : 'bg-gradient-to-b from-green-100 to-green-200 text-green-700 hover:from-green-200 hover:to-green-300 dark:from-green-700 dark:to-green-800 dark:text-green-300 dark:hover:from-green-600 dark:hover:to-green-700'
              }`}
            >
              Add Campaign
            </button>
          </div>
        </div>

        <div className="grid gap-4 w-full">
          {/* Flash messages */}
          {showSuccess && (
            <div className="flex items-start justify-between gap-2 rounded-md bg-green-50 p-3 text-sm text-green-800 dark:bg-green-900/20 dark:text-green-200">
              <span>✅ Campaign created successfully!</span>
              <button onClick={() => setShowSuccess(false)} className="shrink-0 text-green-600 hover:text-green-800 dark:text-green-400 font-bold text-base leading-none" aria-label="Dismiss">✕</button>
            </div>
          )}
          {success && (
            <div className="flex items-start justify-between gap-2 rounded-md bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-800 dark:bg-green-900/20 dark:border-green-800 dark:text-green-200 break-words">
              <span>{success}</span>
              <button onClick={() => setSuccess(null)} className="shrink-0 text-green-600 hover:text-green-800 dark:text-green-400 font-bold text-base leading-none" aria-label="Dismiss">✕</button>
            </div>
          )}
          {error && (
            <div className="flex items-start justify-between gap-2 rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-800 dark:bg-red-900/20 dark:border-red-800 dark:text-red-200 break-words">
              <span>{error}</span>
              <button onClick={() => setError(null)} className="shrink-0 text-red-600 hover:text-red-800 dark:text-red-400 font-bold text-base leading-none" aria-label="Dismiss">✕</button>
            </div>
          )}

          {/* Add Campaign form */}
          {isFormExpanded && contextUser && (
            <CampaignCreateForm
              isAdmin={contextIsAdmin}
              userState={contextUserState}
              userMobileAndLeader={
                contextUserMobile && contextUserLeader
                  ? { mobile: contextUserMobile, leader: contextUserLeader }
                  : null
              }
              userId={contextUser.id}
              categories={campaignCategories}
              onSuccess={async () => {
                setSuccess('Campaign created successfully');
                await refetchCampaigns();
              }}
              onClose={() => setIsFormExpanded(false)}
            />
          )}

          {/* Filters — admin only */}
          {contextIsAdmin && (
            <CampaignFilters
              filterState={filterState}
              filterPlace={filterPlace}
              filterLeader={filterLeader}
              filterMobile={filterMobile}
              placeOptions={filterPlaceOptions}
              leaderOptions={filterLeaderOptions}
              mobileOptions={filterMobileOptions}
              onChange={handleFilterChange}
              onClear={() => {
                setFilterState('');
                setFilterPlace('');
                setFilterLeader('');
                setFilterMobile('');
              }}
            />
          )}

          {/* Campaign list */}
          <div className="rounded-lg border-2 border-gray-800 dark:border-gray-600 bg-white shadow-sm dark:bg-gray-800 w-full overflow-hidden">
            <div className="px-4 py-3 flex items-center justify-between gap-2">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 shrink-0">
                {dateFilter === 'past' && `Past Campaigns (${filteredCampaigns.length})`}
                {dateFilter === 'future' && `Future Campaigns (${filteredCampaigns.length})`}
              </h2>
              {/* View / Edit toggle */}
              <div className="inline-flex rounded-lg border-2 border-gray-800 dark:border-gray-600 overflow-hidden shadow-sm shrink-0">
                <button
                  onClick={() => {
                    setViewMode('view');
                    setEditingId(null);
                    setIsFormExpanded(false);
                  }}
                  className={`px-4 py-1.5 text-sm font-bold transition-colors ${
                    viewMode === 'view'
                      ? 'bg-blue-600 text-white'
                      : 'bg-gradient-to-b from-gray-100 to-gray-200 text-gray-700 hover:from-gray-200 hover:to-gray-300 dark:from-gray-700 dark:to-gray-800 dark:text-gray-300 dark:hover:from-gray-600 dark:hover:to-gray-700'
                  }`}
                >
                  View
                </button>
                <div className="w-px bg-gray-800 dark:bg-gray-600" />
                <button
                  onClick={() => setViewMode('edit')}
                  className={`px-4 py-1.5 text-sm font-bold transition-colors ${
                    viewMode === 'edit'
                      ? 'bg-blue-600 text-white'
                      : 'bg-gradient-to-b from-gray-100 to-gray-200 text-gray-700 hover:from-gray-200 hover:to-gray-300 dark:from-gray-700 dark:to-gray-800 dark:text-gray-300 dark:hover:from-gray-600 dark:hover:to-gray-700'
                  }`}
                >
                  Edit
                </button>
              </div>
            </div>
            {viewMode === 'view' ? (
              <CampaignSlideView campaigns={filteredCampaigns} adminStatus={adminStatus} />
            ) : (
              <CampaignList
                campaigns={filteredCampaigns}
                editingId={editingId}
                dateFilter={dateFilter}
                isAdmin={contextIsAdmin}
                adminStatus={adminStatus}
                userState={userState}
                userMobileAndLeader={userMobileAndLeader}
                sharedWithMeOwners={sharedWithMeOwners}
                savedCheckboxId={savedCheckboxId}
                categories={campaignCategories}
                onEditStart={(id) => setEditingId(id)}
                onCancelEdit={() => setEditingId(null)}
                onSaveEdit={handleSaveEdit}
                onDelete={(campaign) => setDeleteConfirmCampaign(campaign)}
                onToggleCheckbox={handleToggleCheckbox}
                onRecordResults={handleRecordResults}
              />
            )}
          </div>
        </div>
      </div>

      {/* Delete confirmation modal */}
      {deleteConfirmCampaign && (
        <DeleteConfirmModal
          campaign={deleteConfirmCampaign}
          onConfirm={handleConfirmDelete}
          onCancel={() => setDeleteConfirmCampaign(null)}
        />
      )}
    </MobileLayout>
  );
}

export default function AppPage() {
  return (
    <Suspense
      fallback={
        <MobileLayout>
          <div className="flex min-h-screen items-center justify-center">
            <LoadingSpinner />
          </div>
        </MobileLayout>
      }
    >
      <AppPageContent />
    </Suspense>
  );
}
