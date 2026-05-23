'use client';

import { useEffect, useState, useRef, Suspense, useMemo, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import MobileLayout from '@/components/MobileLayout';
import { supabase } from '@/lib/supabaseClient';
import { getUserStateCode } from '@/lib/location';
import { normalizeName, normalizeMobile } from '@/lib/auth';
import { useUser, upsertUserProfile } from '@/contexts/UserContext';
import { getTodayDateString, calculateCampaignDates, formatDateForDb } from '@/lib/campaignDates';
import { getStateColor } from '@/lib/stateColors';
import { generateAndDownloadSlides } from '@/lib/slideGenerator';
import { generateAndDownloadReport } from '@/lib/reportGenerator';
import { generateAndDownloadAriseList } from '@/lib/ariseGenerator';
import { fetchCampaignData } from '@/lib/campaignLog';
import { getSharedWithMeOwners, type LeaderShareOwner } from '@/lib/leaderShares';
import { AUSTRALIAN_STATES } from '@/lib/constants';
import { getErrorMessage } from '@/lib/errorUtils';
import type { Campaign } from '@/lib/types';
import { formatCampaignTimeDisplay, isCampaignPast } from '@/lib/campaignUtils';
import { getPlacesForState, getLeadersForState, getLeaderMobile, getCampaignCategories } from '@/lib/services/dropdownService';
import { createCampaign, updateCampaign, deleteCampaign } from '@/lib/services/campaignService';
import { trackEvent } from '@/lib/analytics';

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

  const [isLoading, setIsLoading] = useState(true);
  const [adminStatus, setAdminStatus] = useState<string | null>(null);
  const [userState, setUserState] = useState<string | null>(null);
  const [userMobileAndLeader, setUserMobileAndLeader] = useState<{ mobile: string | null; leader: string | null } | null>(null);
  const [sharedWithMeOwners, setSharedWithMeOwners] = useState<LeaderShareOwner[]>([]); // Leaders who have shared their campaigns with me
  const [showMoreInfo, setShowMoreInfo] = useState(false); // Toggle for More Info section
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [allCampaigns, setAllCampaigns] = useState<Campaign[]>([]); // Store unfiltered campaigns
  const [showSuccess, setShowSuccess] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  
  // Form state for inline editing
  const [inlineEditingId, setInlineEditingId] = useState<string | null>(null); // Track which campaign is being edited inline
  const [inlineEditState, setInlineEditState] = useState<Record<string, {
    date: string;
    state: string;
    place: string;
    time: string;
    leader: string;
    mobile: string;
    category: string;
    tl_ok: boolean;
    sr_ok: boolean;
  }>>({});
  const [formState, setFormState] = useState({
    date: getTodayDateString(),
    state: '',
    place: '',
    time: '',
    leader: '',
    mobile: '',
    category: 'TWOL',
    tl_ok: false,
    sr_ok: false,
  });
  const [campaignCategories, setCampaignCategories] = useState<{ code: string; name: string }[]>([
    { code: 'TWOL', name: 'Two Weekly' },
    { code: 'BOTJ', name: 'Book of the Judgement' },
    { code: 'TLT', name: 'TLT' },
  ]);
  const [filterState,  setFilterState]  = useState<string>('');
  const [filterPlace,  setFilterPlace]  = useState<string>('');
  const [filterLeader, setFilterLeader] = useState<string>('');
  const [filterMobile, setFilterMobile] = useState<string>('');
  const [isFormExpanded, setIsFormExpanded] = useState<boolean>(false);
  const [dateFilter, setDateFilter] = useState<'past' | 'future'>('future');

  // Admin quick-action bar state
  const [isGeneratingSlides, setIsGeneratingSlides]   = useState(false);
  const [isGeneratingReport, setIsGeneratingReport]   = useState(false);
  const [isGeneratingArise, setIsGeneratingArise]     = useState(false);
  const [quickActionError, setQuickActionError]       = useState<string | null>(null);
  const [quickActionProgress, setQuickActionProgress] = useState<string>('');
  
  // State for "Other Place" functionality
  const [isOtherPlace, setIsOtherPlace] = useState<boolean>(false);
  const [customPlace, setCustomPlace] = useState<string>('');
  const [inlineEditOtherPlace, setInlineEditOtherPlace] = useState<Record<string, boolean>>({});
  const [inlineEditCustomPlace, setInlineEditCustomPlace] = useState<Record<string, string>>({});
   
  // Dropdown data for inline editing (per campaign)
  const [campaignPlaces, setCampaignPlaces] = useState<Record<string, string[]>>({});
  const [campaignLeaders, setCampaignLeaders] = useState<Record<string, string[]>>({});
  

  // Cache for places and leaders by state to avoid repeated queries
  const placesCache = useRef<Record<string, string[]>>({});
  const leadersCache = useRef<Record<string, string[]>>({});


  // Helper function to apply date filter
  const applyDateFilter = useCallback((campaignsToFilter: Campaign[]) => {
    const now = new Date();
    
    return campaignsToFilter.filter(campaign => {
      // Parse campaign date and time
      const campaignDate = new Date(campaign.date);
      
      // Parse time string (format: HH:MM or HH:MM:SS)
      let timeStr = campaign.time;
      if (timeStr.includes('T')) {
        // Handle ISO timestamp format
        timeStr = timeStr.split('T')[1]?.split('.')[0] || timeStr;
      }
      const [hours, minutes] = timeStr.split(':').map(Number);
      
      // Set the campaign date and time
      const campaignDateTime = new Date(campaignDate);
      campaignDateTime.setHours(hours || 0, minutes || 0, 0, 0);
      
      if (dateFilter === 'past') {
        return campaignDateTime < now;
      } else if (dateFilter === 'future') {
        return campaignDateTime > now;
      }
      return true;
    });
  }, [dateFilter]);

  // Reusable function to refetch campaigns (optimized to avoid duplicate queries)
  const refetchCampaigns = useCallback(async () => {
    if (!contextUser) return;
    
    const { getUserAdminStatusAndMobile } = await import('@/lib/campaignFilter');
    const { normalizeMobile } = await import('@/lib/auth');
    const { getSharedWithMeOwners } = await import('@/lib/leaderShares');
    const { admin: adminStatusValue, state: userStateValue, mobile, leader } = await getUserAdminStatusAndMobile();
    const userMobileAndLeaderData = mobile && leader ? { mobile, leader } : null;
    
    // Update state variables
    setAdminStatus(adminStatusValue);
    setUserState(userStateValue);
    
    let sharedOwnersList: LeaderShareOwner[] = [];
    if (adminStatusValue !== 'AD' && adminStatusValue !== 'SR' && userMobileAndLeaderData?.leader && userStateValue) {
      sharedOwnersList = await getSharedWithMeOwners(userStateValue, userMobileAndLeaderData.leader);
      setSharedWithMeOwners(sharedOwnersList);
    }
    
    let query = supabase.from('campaigns').select('*');
    
    if (adminStatusValue === 'AD') {
      // No filter
    } else if (adminStatusValue === 'SR') {
      if (userStateValue) {
        query = query.eq('state', userStateValue.toUpperCase().trim());
      } else {
        query = query.eq('user_id', contextUser.id);
      }
    } else {
      if (userMobileAndLeaderData?.mobile && userMobileAndLeaderData?.leader) {
        query = query.eq('leader', userMobileAndLeaderData.leader.trim());
      } else {
        query = query.eq('user_id', contextUser.id);
      }
    }
    
    const { data, error: fetchError } = await query
      .order('date', { ascending: true })
      .order('state', { ascending: true })
      .order('place', { ascending: true })
      .order('time', { ascending: true });
    
    if (fetchError) throw fetchError;
    
    let dataMerged: Campaign[] = (data || []) as Campaign[];
    if (adminStatusValue !== 'AD' && adminStatusValue !== 'SR' && sharedOwnersList.length > 0) {
      // Use individual parameterised .eq() calls per shared owner rather than
      // string-interpolated .or() to avoid filter injection via crafted DB values.
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
            .order('time', { ascending: true })
        )
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
      if (userMobileAndLeaderData?.mobile && userStateValue) {
        const normalizedMobile = normalizeMobile(userMobileAndLeaderData.mobile);
        const isSharedCampaign = (c: Campaign) =>
          sharedOwnersList.some(
            (o) =>
              (o.owner_state || '').toUpperCase().trim() === (c.state || '').toUpperCase().trim() &&
              normalizeName(o.owner_leader) === normalizeName(c.leader || '')
          );
        filteredData = dataMerged.filter(
          (c) =>
            isSharedCampaign(c) ||
            (!!c.mobile && normalizeMobile(c.mobile) === normalizedMobile)
        );
      }
    }
    
    setAllCampaigns(filteredData);
    
    // Apply state filter if set
    let finalData = filteredData;
    if (filterState) {
      finalData = finalData.filter(c => c.state.toUpperCase() === filterState.toUpperCase());
    }
    
    // Apply date filter
    finalData = applyDateFilter(finalData);
    
    setCampaigns(finalData);
  }, [contextUser, filterState, applyDateFilter]);
  
  // Load campaign categories from DB on mount (fallback to hardcoded defaults if table not ready)
  useEffect(() => {
    getCampaignCategories().then((cats) => {
      if (cats.length > 0) setCampaignCategories(cats);
    });
  }, []);

  // Load places from state_places table when state changes in inline edit (with caching)
  useEffect(() => {
    if (inlineEditingId && inlineEditState[inlineEditingId]) {
      const editData = inlineEditState[inlineEditingId];
      const campaignId = inlineEditingId; // Capture for type narrowing
      if (editData.state) {
        const normalizedState = editData.state.toUpperCase().trim();
        
        // Check cache first
        if (placesCache.current[normalizedState]) {
          setCampaignPlaces(prev => ({
            ...prev,
            [campaignId]: placesCache.current[normalizedState],
          }));
        } else {
          getPlacesForState(normalizedState).then((uniquePlaces) => {
            placesCache.current[normalizedState] = uniquePlaces;
            setCampaignPlaces(prev => ({ ...prev, [campaignId]: uniquePlaces }));
          });
        }
      } else {
        // Clear places if no state selected
        setCampaignPlaces(prev => {
          const newState = { ...prev };
          delete newState[campaignId];
          return newState;
        });
      }
    }
  }, [inlineEditingId, inlineEditState]);
  
  // Load leaders from state_leaders table when state changes in inline edit (with caching)
  useEffect(() => {
    if (inlineEditingId && inlineEditState[inlineEditingId]) {
      const editData = inlineEditState[inlineEditingId];
      const campaignId = inlineEditingId; // Capture for type narrowing
      if (editData.state) {
        const normalizedState = editData.state.toUpperCase().trim();
        
        // Check cache first
        if (leadersCache.current[normalizedState]) {
          setCampaignLeaders(prev => ({
            ...prev,
            [campaignId]: leadersCache.current[normalizedState],
          }));
        } else {
          getLeadersForState(normalizedState).then((uniqueLeaders) => {
            leadersCache.current[normalizedState] = uniqueLeaders;
            setCampaignLeaders(prev => ({ ...prev, [campaignId]: uniqueLeaders }));
          });
        }
      } else {
        // Clear leaders if no state selected
        setCampaignLeaders(prev => {
          const newState = { ...prev };
          delete newState[campaignId];
          return newState;
        });
      }
    }
  }, [inlineEditingId, inlineEditState]);
  
  // Dropdown data
  const [places, setPlaces] = useState<string[]>([]);
  const [leaders, setLeaders] = useState<string[]>([]);
  const [timeOptions, setTimeOptions] = useState<{ value: string; label: string }[]>([]);
  const [loadingPlaces, setLoadingPlaces] = useState(false);
  const [loadingLeaders, setLoadingLeaders] = useState(false);
  const isEditingRef = useRef(false); // Flag to prevent useEffect interference during edit
  const pendingEditDataRef = useRef<{ campaign: Campaign; timeValue: string } | null>(null); // Store campaign data for edit

  // Initialise page once the user context has finished loading.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (isUserLoading) return;

    if (!contextUser) {
      router.push('/login');
      return;
    }

    async function initPage() {
      try {
        // Seed local campaign-filter state from context (no extra network call)
        setAdminStatus(contextAdminStatus);
        setUserState(contextUserState);
        if (contextUserMobile && contextUserLeader) {
          setUserMobileAndLeader({ mobile: contextUserMobile, leader: contextUserLeader });
        }

        // First-login onboarding: create profile when pendingFirstName is in sessionStorage
        if (!contextUserProfile) {
          const pendingFirstName = sessionStorage.getItem('pendingFirstName');
          if (pendingFirstName) {
            try {
              let stateCode: string | null = null;
              try {
                const { stateCode: sc } = await getUserStateCode();
                stateCode = sc;
              } catch {}
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
          setTimeout(() => setShowSuccess(false), 5000);
        }

        // Generate time options
        const times: { value: string; label: string }[] = [];
        for (let hour = 8; hour <= 20; hour++) {
          for (let minute = 0; minute < 60; minute += 30) {
            const timeStr = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
            const displayHour = hour % 12 || 12;
            const ampm = hour >= 12 ? 'PM' : 'AM';
            times.push({ value: timeStr, label: `${displayHour}:${minute.toString().padStart(2, '0')} ${ampm}` });
          }
        }
        setTimeOptions(times);

        // Load campaigns
        let sharedOwnersList: LeaderShareOwner[] = [];
        let query = supabase.from('campaigns').select('*');

        if (contextAdminStatus === 'AD') {
          // no filter — see all campaigns
        } else if (contextAdminStatus === 'SR') {
          if (contextUserState) {
            query = query.eq('state', contextUserState.toUpperCase().trim());
          } else {
            query = query.eq('user_id', contextUser!.id);
          }
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
                .order('time', { ascending: true })
            )
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
                  normalizeName(o.owner_leader) === normalizeName(c.leader || '')
              );
            filteredData = dataMerged.filter(
              (campaign) =>
                isSharedCampaign(campaign) ||
                (!!campaign.mobile && normalizeMobile(campaign.mobile) === normalizedMobile)
            );
          }
        }

        setAllCampaigns(filteredData);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        const isAuthError =
          msg.toLowerCase().includes('auth') ||
          msg.toLowerCase().includes('session') ||
          msg.toLowerCase().includes('jwt');
        if (isAuthError) router.push('/login');
        else console.error('App page initialization error:', error);
      } finally {
        setIsLoading(false);
      }
    }

    initPage();
  }, [isUserLoading, contextUser]);

  // Memoize filtered campaigns to avoid recalculating on every render
  const filteredCampaigns = useMemo(() => {
    if (allCampaigns.length === 0) return [];

    let filtered = allCampaigns;

    if (filterState)  filtered = filtered.filter(c => c.state.toUpperCase() === filterState.toUpperCase());
    if (filterPlace)  filtered = filtered.filter(c => (c.place  ?? '').toLowerCase().includes(filterPlace.toLowerCase()));
    if (filterLeader) filtered = filtered.filter(c => (c.leader ?? '').toLowerCase().includes(filterLeader.toLowerCase()));
    if (filterMobile) filtered = filtered.filter(c => (c.mobile ?? '').replace(/\s/g, '').includes(filterMobile.replace(/\s/g, '')));

    filtered = applyDateFilter(filtered);

    return filtered;
  }, [allCampaigns, filterState, filterPlace, filterLeader, filterMobile, applyDateFilter]);

  // Apply state and date filters when they change
  useEffect(() => {
    setCampaigns(filteredCampaigns);
  }, [filteredCampaigns]);
  
  // Load places from state_places table when state changes (with caching)
  useEffect(() => {
    // Skip if we're in the middle of editing (loading data programmatically)
    if (isEditingRef.current) {
      return;
    }
    
    async function loadPlaces() {
      if (!formState.state) {
        setPlaces([]);
        return;
      }
      
      const normalizedState = formState.state.toUpperCase().trim();
      
      // Check cache first
      if (placesCache.current[normalizedState]) {
        setPlaces(placesCache.current[normalizedState]);
        return;
      }
      
      setLoadingPlaces(true);
      getPlacesForState(normalizedState)
        .then((uniquePlaces) => {
          placesCache.current[normalizedState] = uniquePlaces;
          setPlaces(uniquePlaces);
        })
        .finally(() => setLoadingPlaces(false));
    }

    loadPlaces();
  }, [formState.state]);

  // Load leaders from state_leaders table when state changes (with caching)
  useEffect(() => {
    if (isEditingRef.current) return;

    async function loadLeaders() {
      if (!formState.state) {
        setLeaders([]);
        return;
      }

      const normalizedState = formState.state.toUpperCase().trim();

      if (leadersCache.current[normalizedState]) {
        setLeaders(leadersCache.current[normalizedState]);
        return;
      }

      setLoadingLeaders(true);
      getLeadersForState(normalizedState)
        .then((uniqueLeaders) => {
          leadersCache.current[normalizedState] = uniqueLeaders;
          setLeaders(uniqueLeaders);
        })
        .finally(() => setLoadingLeaders(false));
    }

    loadLeaders();
  }, [formState.state]);
  
  // Set default state from user profile when profile is loaded
  useEffect(() => {
    if (contextUserProfile?.state && !formState.state) {
      setFormState(prev => ({
        ...prev,
        state: contextUserProfile.state!.toUpperCase().trim(),
      }));
    }
  }, [contextUserProfile]);

  // When Create Campaign form expands for non-admin/SR users: set state if empty, then default leader and mobile
  useEffect(() => {
    if (!isFormExpanded || isEditingRef.current) return;
    const isAdminOrSR = adminStatus === 'AD' || adminStatus === 'SR';
    if (isAdminOrSR) return;

    // Ensure state is set for non-admin users (they can't change it - dropdown is disabled)
    if (!formState.state && userState) {
      setFormState(prev => ({ ...prev, state: userState.toUpperCase().trim() }));
      return;
    }

    if (!userMobileAndLeader?.leader || !formState.state || loadingLeaders) return;
    // Only default when leader is not yet set and state matches user's state
    if (formState.leader) return;
    const stateMatches = (formState.state || '').toUpperCase().trim() === (userState || '').toUpperCase().trim();
    if (!stateMatches || !leaders.includes(userMobileAndLeader.leader)) return;
    setFormState(prev => ({
      ...prev,
      leader: userMobileAndLeader.leader!,
      mobile: userMobileAndLeader.mobile || prev.mobile,
    }));
  }, [isFormExpanded, adminStatus, userMobileAndLeader, userState, formState.state, formState.leader, leaders, loadingLeaders]);
  
  // Effect to set form values after dropdowns are populated during edit
  useEffect(() => {
    if (isEditingRef.current && pendingEditDataRef.current) {
      const { campaign, timeValue } = pendingEditDataRef.current;
      
      // Check if we have the necessary dropdown data
      // For places, we need at least the campaign's place to be in the list (or list can be empty if no matches)
      // For leaders, we need at least the campaign's leader to be in the list (or list can be empty if no matches)
      const hasPlace = !campaign.place || places.length === 0 || places.includes(campaign.place);
      const hasLeader = !campaign.leader || leaders.length === 0 || leaders.includes(campaign.leader);
      
      // Only set form values if dropdowns are ready (either populated or empty)
      // We check that places and leaders have been set (even if empty arrays)
      if (hasPlace && hasLeader) {
        // Set form values now that dropdowns are ready
        setFormState({
          date: campaign.date,
          state: campaign.state,
          place: campaign.place,
          time: timeValue,
          leader: campaign.leader,
          mobile: campaign.mobile || '',
          category: campaign.category ?? 'TWOL',
          tl_ok: campaign.tl_ok || false,
          sr_ok: campaign.sr_ok || false,
        });
        
        // Clear the pending data and flag
        pendingEditDataRef.current = null;
        setTimeout(() => {
          isEditingRef.current = false;
        }, 100);
      }
    }
  }, [places, leaders]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setIsSubmitting(true);

    try {
      if (!contextUser) throw new Error('You must be logged in');

      // Handle "Other Place" - insert into state_places table if needed
      let placeValue = formState.place;
      if (isOtherPlace && customPlace.trim()) {
        if (!formState.state || !formState.state.trim()) {
          throw new Error('Please select a state before entering a new place');
        }

        const newPlace = customPlace.trim();
        const stateValue = formState.state.toUpperCase().trim();

        const { error: placeError } = await supabase
          .from('state_places')
          .insert([{ state: stateValue, place: newPlace }]);

        if (placeError && placeError.code !== '23505') {
          throw new Error(`Failed to add new place: ${placeError.message}`);
        }

        placeValue = newPlace;

        const uniquePlaces = await getPlacesForState(stateValue);
        placesCache.current[stateValue] = uniquePlaces;
        setPlaces(uniquePlaces);
      }

      if (!placeValue || placeValue.trim() === '') {
        throw new Error('Please select or enter a place');
      }

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
        user_id: contextUser.id,
        source: 'MAN',
      });

      trackEvent('campaign_create', { state: formState.state, category: formState.category ?? 'TWOL' });
      setSuccess('Campaign created successfully');
      setFormState({ date: '', state: '', place: '', time: '', leader: '', mobile: '', category: 'TWOL', tl_ok: false, sr_ok: false });
      setIsOtherPlace(false);
      setCustomPlace('');
      setIsFormExpanded(false);
      await refetchCampaigns();
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Failed to save campaign'));
    } finally {
      setIsSubmitting(false);
    }
  };
  
  const handleEdit = async (campaign: Campaign) => {
    // Parse time to HH:MM format (remove seconds if present)
    let timeValue = campaign.time;
    if (campaign.time.includes('T')) {
      // Handle ISO timestamp format
      timeValue = campaign.time.split('T')[1]?.split('.')[0] || campaign.time;
    }
    // Remove seconds if present (e.g., "09:30:00" -> "09:30")
    if (timeValue && timeValue.includes(':')) {
      const parts = timeValue.split(':');
      if (parts.length >= 2) {
        timeValue = `${parts[0].padStart(2, '0')}:${parts[1].padStart(2, '0')}`;
      }
    }
    
    // Normalize state to uppercase to match dropdown options
    const normalizedState = campaign.state ? campaign.state.toUpperCase().trim() : '';
    
    // Load places for the state from state_places table (with caching)
    if (normalizedState) {
      // Check cache first
      if (placesCache.current[normalizedState]) {
        setCampaignPlaces(prev => ({
          ...prev,
          [campaign.id]: placesCache.current[normalizedState],
        }));
      } else {
        getPlacesForState(normalizedState).then((uniquePlaces) => {
          placesCache.current[normalizedState] = uniquePlaces;
          setCampaignPlaces(prev => ({ ...prev, [campaign.id]: uniquePlaces }));
        });
      }

      if (leadersCache.current[normalizedState]) {
        setCampaignLeaders(prev => ({ ...prev, [campaign.id]: leadersCache.current[normalizedState] }));
      } else {
        getLeadersForState(normalizedState).then((uniqueLeaders) => {
          leadersCache.current[normalizedState] = uniqueLeaders;
          setCampaignLeaders(prev => ({ ...prev, [campaign.id]: uniqueLeaders }));
        });
      }
    }
    
    // Set inline editing state immediately
    setInlineEditingId(campaign.id);
    setInlineEditState({
      [campaign.id]: {
        date: campaign.date || '',
        state: normalizedState,
        place: campaign.place || '',
        time: timeValue || '',
        leader: campaign.leader || '',
        mobile: campaign.mobile || '',
        category: campaign.category ?? 'TWOL',
        tl_ok: campaign.tl_ok || false,
        sr_ok: campaign.sr_ok || false,
      }
    });
  };


  const handleSaveInlineEdit = async (campaignId: string) => {
    const editData = inlineEditState[campaignId];
    if (!editData) return;

    setError(null);
    setSuccess(null);

    try {
      // Handle "Other Place"
      let placeValue = editData.place;
      const isOther = inlineEditOtherPlace[campaignId];
      const customPlaceValue = inlineEditCustomPlace[campaignId];

      if (isOther && customPlaceValue && customPlaceValue.trim()) {
        if (!editData.state || !editData.state.trim()) {
          throw new Error('Please select a state before entering a new place');
        }

        const newPlace = customPlaceValue.trim();
        const stateValue = editData.state.toUpperCase().trim();

        const { error: placeError } = await supabase
          .from('state_places')
          .insert([{ state: stateValue, place: newPlace }]);

        if (placeError && placeError.code !== '23505') {
          throw new Error(`Failed to add new place: ${placeError.message}`);
        }

        placeValue = newPlace;

        const uniquePlaces = await getPlacesForState(stateValue);
        placesCache.current[stateValue] = uniquePlaces;
        setCampaignPlaces(prev => ({ ...prev, [campaignId]: uniquePlaces }));
      }

      if (!placeValue || placeValue.trim() === '') {
        throw new Error('Please select or enter a place');
      }

      const oldData = await fetchCampaignData(campaignId);

      const updates = {
        date: editData.date,
        state: editData.state,
        place: placeValue,
        time: editData.time,
        leader: editData.leader,
        mobile: editData.mobile.trim() || null,
        category: editData.category ?? 'TWOL',
        tl_ok: editData.tl_ok,
        sr_ok: editData.sr_ok,
      };

      await updateCampaign(campaignId, updates, oldData);

      trackEvent('campaign_update', { state: editData.state });
      setSuccess('Campaign updated successfully');
      setInlineEditingId(null);
      setInlineEditOtherPlace(prev => { const s = { ...prev }; delete s[campaignId]; return s; });
      setInlineEditCustomPlace(prev => { const s = { ...prev }; delete s[campaignId]; return s; });
      await refetchCampaigns();
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Failed to update campaign'));
    }
  };
  
  const handleCancelInlineEdit = () => {
    setInlineEditingId(null);
    setInlineEditState({});
    setError(null);
  };
  
  const updateInlineEditField = async (campaignId: string, field: string, value: string | boolean) => {
    // If state is being changed, clear "Other Place" state
    if (field === 'state') {
      setInlineEditOtherPlace(prev => {
        const newState = { ...prev };
        delete newState[campaignId];
        return newState;
      });
      setInlineEditCustomPlace(prev => {
        const newState = { ...prev };
        delete newState[campaignId];
        return newState;
      });
    }
    
    // If leader is being changed, fetch and update mobile from state_leaders table
    if (field === 'leader') {
      if (value && typeof value === 'string') {
        // Leader is being set - fetch mobile from state_leaders table
        const editData = inlineEditState[campaignId];
        if (editData?.state) {
          const mobile = await getLeaderMobile(editData.state, value);
          if (mobile) {
            setInlineEditState(prev => ({
              ...prev,
              [campaignId]: { ...prev[campaignId], leader: value, mobile },
            }));
            return;
          }
        }
      } else {
        // Leader is being cleared - also clear mobile
        setInlineEditState(prev => ({
          ...prev,
          [campaignId]: {
            ...prev[campaignId],
            leader: '',
            mobile: '',
          }
        }));
        return;
      }
    }
    
    // Default update for other fields
    setInlineEditState(prev => ({
      ...prev,
      [campaignId]: {
        ...prev[campaignId],
        [field]: value,
      }
    }));
  };
  
  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this campaign?')) return;

    try {
      const oldData = await fetchCampaignData(id);
      await deleteCampaign(id, oldData);
      trackEvent('campaign_delete');
      setSuccess('Campaign deleted successfully');
      await refetchCampaigns();
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Failed to delete campaign'));
    }
  };

  const handleToggleCheckbox = async (campaignId: string, field: 'tl_ok' | 'sr_ok', currentValue: boolean) => {
    const newValue = !currentValue;

    // Optimistic update
    const applyToRow = (val: boolean) => (c: Campaign) =>
      c.id === campaignId ? { ...c, [field]: val } : c;
    setCampaigns(prev => prev.map(applyToRow(newValue)));
    setAllCampaigns(prev => prev.map(applyToRow(newValue)));

    try {
      const oldData = await fetchCampaignData(campaignId);
      await updateCampaign(campaignId, { [field]: newValue }, oldData);
    } catch (err: unknown) {
      // Rollback on error
      setCampaigns(prev => prev.map(applyToRow(currentValue)));
      setAllCampaigns(prev => prev.map(applyToRow(currentValue)));
      setError(getErrorMessage(err, 'Failed to update verification status'));
    }
  };
  

  // -------------------------------------------------------------------------
  // Admin quick-action handlers
  // -------------------------------------------------------------------------

  const handleQuickSlides = async () => {
    setIsGeneratingSlides(true);
    setQuickActionError(null);
    setQuickActionProgress('');
    try {
      const { upcomingCampaignStart } = calculateCampaignDates();
      await generateAndDownloadSlides({
        supabase,
        startDate:   upcomingCampaignStart,
        adminStatus: contextAdminStatus,
        userState:   contextUserState,
        onProgress:  setQuickActionProgress,
      });
      trackEvent('generate_slides', { state: contextUserState });
    } catch (err: unknown) {
      setQuickActionError(err instanceof Error ? err.message : 'Failed to generate campaign lists');
    } finally {
      setIsGeneratingSlides(false);
    }
  };

  const handleQuickReport = async () => {
    setIsGeneratingReport(true);
    setQuickActionError(null);
    setQuickActionProgress('');
    try {
      const { pastCampaignStart } = calculateCampaignDates();
      const pastEnd = new Date(pastCampaignStart);
      pastEnd.setDate(pastEnd.getDate() + 6);
      await generateAndDownloadReport({
        supabase,
        startDate:   formatDateForDb(pastCampaignStart),
        endDate:     formatDateForDb(pastEnd),
        adminStatus: contextAdminStatus,
        userState:   contextUserState,
      });
      trackEvent('generate_report', { state: contextUserState });
    } catch (err: unknown) {
      setQuickActionError(err instanceof Error ? err.message : 'Failed to generate campaign results');
    } finally {
      setIsGeneratingReport(false);
    }
  };

  const handleQuickArise = async () => {
    setIsGeneratingArise(true);
    setQuickActionError(null);
    setQuickActionProgress('');
    try {
      const { upcomingCampaignStart } = calculateCampaignDates();
      await generateAndDownloadAriseList({
        supabase,
        startDate:   upcomingCampaignStart,
        adminStatus: contextAdminStatus,
        userState:   contextUserState,
        onProgress:  setQuickActionProgress,
      });
      trackEvent('generate_week1', { state: contextUserState });
    } catch (err: unknown) {
      setQuickActionError(err instanceof Error ? err.message : 'Failed to generate Week 1 Campaigns list');
    } finally {
      setIsGeneratingArise(false);
    }
  };

  if (isUserLoading || isLoading) {
    return (
      <MobileLayout>
        <div className="flex min-h-screen items-center justify-center">
          <div className="text-gray-600 dark:text-gray-400">Loading...</div>
        </div>
      </MobileLayout>
    );
  }

  return (
    <MobileLayout>
      <div className="p-4 max-w-full overflow-x-hidden">
        <div className="mb-6">
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-gray-100 break-words">
            {contextUserProfile?.name ? (() => {
              // Remove underscore and everything after it for display only
              const displayName = contextUserProfile!.name!.includes('_')
                ? contextUserProfile!.name!.split('_')[0]
                : contextUserProfile!.name!;
              return `Welcome back ${displayName}!`;
            })() : 'Welcome back!'}
          </h1>
          <div className="mt-1">
            <p className="text-sm sm:text-base text-gray-600 dark:text-gray-400 break-words inline">
              {adminStatus === 'AD' 
                ? 'You have signed in as an Administrator and can manage all campaign records and access all admin functions'
                : adminStatus === 'SR'
                ? 'You have signed in as a State Reporter and can manage all campaign records in your state'
                : 'You have signed in as a Team Leader and can manage all campaigns that you lead here'
              }
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
                  : 'More info to come soon'
                }
              </div>
            )}
          </div>

          {/* Admin Quick Actions — visible to full admins only */}
          {contextAdminStatus === 'AD' && (
            <div className="mt-4 rounded-lg border-2 border-purple-300 bg-purple-50 p-3 dark:border-purple-700 dark:bg-purple-900/20">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-purple-700 dark:text-purple-400">
                Admin Quick Actions
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={handleQuickSlides}
                  disabled={isGeneratingSlides || isGeneratingReport || isGeneratingArise}
                  className={`rounded-md px-4 py-2 text-sm font-bold text-white focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 border-2 border-gray-800 dark:border-gray-600 cursor-pointer ${
                    isGeneratingSlides
                      ? 'bg-gray-400 cursor-not-allowed'
                      : (isGeneratingReport || isGeneratingArise)
                        ? 'bg-purple-600 opacity-40 cursor-not-allowed'
                        : 'bg-purple-600 hover:bg-purple-700'
                  }`}
                >
                  {isGeneratingSlides ? 'Generating…' : 'Campaign Lists'}
                </button>
                <button
                  onClick={handleQuickReport}
                  disabled={isGeneratingSlides || isGeneratingReport || isGeneratingArise}
                  className={`rounded-md px-4 py-2 text-sm font-bold text-white focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 border-2 border-gray-800 dark:border-gray-600 cursor-pointer ${
                    isGeneratingReport
                      ? 'bg-gray-400 cursor-not-allowed'
                      : (isGeneratingSlides || isGeneratingArise)
                        ? 'bg-purple-600 opacity-40 cursor-not-allowed'
                        : 'bg-purple-600 hover:bg-purple-700'
                  }`}
                >
                  {isGeneratingReport ? 'Generating…' : 'Campaign Results'}
                </button>
                <button
                  onClick={handleQuickArise}
                  disabled={isGeneratingSlides || isGeneratingReport || isGeneratingArise}
                  className={`rounded-md px-4 py-2 text-sm font-bold text-white focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 border-2 border-gray-800 dark:border-gray-600 cursor-pointer ${
                    isGeneratingArise
                      ? 'bg-gray-400 cursor-not-allowed'
                      : (isGeneratingSlides || isGeneratingReport)
                        ? 'bg-purple-600 opacity-40 cursor-not-allowed'
                        : 'bg-purple-600 hover:bg-purple-700'
                  }`}
                >
                  {isGeneratingArise ? 'Generating…' : 'Week 1 Campaigns'}
                </button>
              </div>
              {quickActionProgress && !quickActionError && (
                <p className="mt-2 text-xs text-purple-700 dark:text-purple-300">{quickActionProgress}</p>
              )}
              {quickActionError && (
                <p className="mt-2 text-xs font-medium text-red-600 dark:text-red-400">⚠ {quickActionError}</p>
              )}
            </div>
          )}

          {/* Date Filter Segmented Control + Create Button */}
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
              Create
            </button>
          </div>
        </div>

        {showSuccess && (
          <div className="mb-4 rounded-md bg-green-50 p-3 text-sm text-green-800 dark:bg-green-900/20 dark:text-green-200">
            ✅ Campaign created successfully!
          </div>
        )}

        <div className="grid gap-4 w-full">
          {/* Success/Error Messages */}
          {success && (
            <div className="rounded-md bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-800 dark:bg-green-900/20 dark:border-green-800 dark:text-green-200 break-words">
              {success}
            </div>
          )}
          {error && (
            <div className="rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-800 dark:bg-red-900/20 dark:border-red-800 dark:text-red-200 break-words">
              {error}
            </div>
          )}

          {/* Add/Edit Form */}
          {isFormExpanded && (
            <div className="rounded-lg border-2 border-gray-800 dark:border-gray-600 bg-white shadow-sm dark:bg-gray-800 w-full overflow-hidden">
              <div className="flex items-center justify-between p-4">
                <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                  Create Campaign
                </h2>
                <button
                  type="button"
                  onClick={() => setIsFormExpanded(false)}
                  className="rounded-md bg-red-600 px-3 py-1 text-base font-bold text-white hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 border-2 border-gray-800 dark:border-gray-600"
                >
                  Close
                </button>
              </div>
              <div className="p-4 pt-0 bg-blue-50 dark:bg-blue-900/20 rounded-b-lg">
                <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label htmlFor="date" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                  Date
                </label>
                <input
                  type="date"
                  id="date"
                  required
                  value={formState.date}
                  onChange={(e) => setFormState({ ...formState, date: e.target.value })}
                  className="mt-1 block w-full rounded-md border-2 border-gray-400 bg-white px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500 dark:border-gray-500 dark:bg-gray-900 dark:text-white"
                />
              </div>
              <div>
                <label htmlFor="state" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                  State
                </label>
                <select
                  id="state"
                  required
                  value={formState.state}
                  onChange={(e) => {
                    setFormState({ ...formState, state: e.target.value, place: '', leader: '' });
                    setIsOtherPlace(false);
                    setCustomPlace('');
                  }}
                  disabled={!contextIsAdmin}
                  className="mt-1 block w-full rounded-md border-2 border-gray-400 bg-white px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500 dark:border-gray-500 dark:bg-gray-900 dark:text-white disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <option value="">Select a state</option>
                  {AUSTRALIAN_STATES.map((state) => (
                    <option key={state} value={state}>
                      {state}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="place" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                  Place
                </label>
                <select
                  id="place"
                  required={!isOtherPlace}
                  value={isOtherPlace ? 'OTHER_PLACE' : formState.place}
                  onChange={(e) => {
                    if (e.target.value === 'OTHER_PLACE') {
                      setIsOtherPlace(true);
                      setFormState({ ...formState, place: '', leader: '', mobile: '' });
                    } else {
                      setIsOtherPlace(false);
                      setCustomPlace('');
                      setFormState({ ...formState, place: e.target.value, leader: '', mobile: '' });
                    }
                  }}
                  disabled={!formState.state || loadingPlaces}
                  className="mt-1 block w-full rounded-md border-2 border-gray-400 bg-white px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500 dark:border-gray-500 dark:bg-gray-900 dark:text-white disabled:opacity-50"
                >
                  <option value="">{loadingPlaces ? 'Loading...' : 'Select a place'}</option>
                  {places.map((place) => (
                    <option key={place} value={place}>
                      {place}
                    </option>
                  ))}
                  <option value="OTHER_PLACE">Other Place</option>
                </select>
                {isOtherPlace && (
                  <input
                    type="text"
                    id="customPlace"
                    required
                    value={customPlace}
                    onChange={(e) => setCustomPlace(e.target.value)}
                    placeholder="Enter new place name"
                    className="mt-2 block w-full rounded-md border-2 border-gray-400 bg-white px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500 dark:border-gray-500 dark:bg-gray-900 dark:text-white"
                  />
                )}
              </div>
              <div>
                <label htmlFor="time" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                  Time
                </label>
                <select
                  id="time"
                  required
                  value={formState.time}
                  onChange={(e) => setFormState({ ...formState, time: e.target.value })}
                  className="mt-1 block w-full rounded-md border-2 border-gray-400 bg-white px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500 dark:border-gray-500 dark:bg-gray-900 dark:text-white"
                >
                  <option value="">Select a time</option>
                  {timeOptions.map((time) => (
                    <option key={time.value} value={time.value}>
                      {time.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="leader" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                  Leader
                </label>
                <select
                  id="leader"
                  required
                  value={formState.leader}
                  onChange={async (e) => {
                    const newLeader = e.target.value;
                    // If leader is selected, fetch and update mobile from state_leaders table
                    if (newLeader && formState.state) {
                      const mobile = await getLeaderMobile(formState.state, newLeader);
                      setFormState({ ...formState, leader: newLeader, mobile: mobile || '' });
                    } else {
                      // Clear leader and mobile if leader is cleared
                      setFormState({ ...formState, leader: '', mobile: '' });
                    }
                  }}
                  disabled={!formState.state || loadingLeaders}
                  className="mt-1 block w-full rounded-md border-2 border-gray-400 bg-white px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500 dark:border-gray-500 dark:bg-gray-900 dark:text-white disabled:opacity-50"
                >
                  <option value="">{loadingLeaders ? 'Loading...' : 'Select a leader'}</option>
                  {leaders.map((leader) => (
                    <option key={leader} value={leader}>
                      {leader}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="mobile" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                  Mobile (Optional)
                </label>
                <input
                  id="mobile"
                  type="tel"
                  value={formState.mobile}
                  onChange={(e) => setFormState({ ...formState, mobile: e.target.value })}
                  className="mt-1 block w-full rounded-md border-2 border-gray-400 bg-white px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500 dark:border-gray-500 dark:bg-gray-900 dark:text-white"
                  placeholder="Enter mobile number"
                />
              </div>
              <div>
                <label htmlFor="category" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                  Category
                </label>
                <select
                  id="category"
                  required
                  value={formState.category}
                  onChange={(e) => setFormState({ ...formState, category: e.target.value })}
                  className="mt-1 block w-full rounded-md border-2 border-gray-400 bg-white px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500 dark:border-gray-500 dark:bg-gray-900 dark:text-white"
                >
                  {campaignCategories.map((cat) => (
                    <option key={cat.code} value={cat.code}>{cat.name}</option>
                  ))}
                </select>
              </div>
              
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="flex-1 rounded-md bg-blue-600 px-4 py-2 text-base font-bold text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed border-2 border-gray-800 dark:border-gray-600"
                >
                  {isSubmitting ? 'Creating...' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

          {/* Filters — admin only */}
          {contextIsAdmin && (
            <div className="w-full space-y-2">
              <div className="grid grid-cols-2 gap-2">
                {/* State */}
                <div>
                  <label htmlFor="filter-state" className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                    State
                  </label>
                  <select
                    id="filter-state"
                    value={filterState}
                    onChange={(e) => setFilterState(e.target.value)}
                    className="block w-full rounded-md border-2 border-gray-400 bg-white px-2 py-1.5 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500 dark:border-gray-500 dark:bg-gray-900 dark:text-white"
                  >
                    <option value="">All States</option>
                    {AUSTRALIAN_STATES.map((state) => (
                      <option key={state} value={state}>{state}</option>
                    ))}
                  </select>
                </div>
                {/* Place */}
                <div>
                  <label htmlFor="filter-place" className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                    Place
                  </label>
                  <input
                    id="filter-place"
                    type="text"
                    value={filterPlace}
                    onChange={(e) => setFilterPlace(e.target.value)}
                    placeholder="e.g. CBD"
                    className="block w-full rounded-md border-2 border-gray-400 bg-white px-2 py-1.5 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500 dark:border-gray-500 dark:bg-gray-900 dark:text-white"
                  />
                </div>
                {/* Leader */}
                <div>
                  <label htmlFor="filter-leader" className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                    Leader
                  </label>
                  <input
                    id="filter-leader"
                    type="text"
                    value={filterLeader}
                    onChange={(e) => setFilterLeader(e.target.value)}
                    placeholder="e.g. Peter"
                    className="block w-full rounded-md border-2 border-gray-400 bg-white px-2 py-1.5 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500 dark:border-gray-500 dark:bg-gray-900 dark:text-white"
                  />
                </div>
                {/* Mobile */}
                <div>
                  <label htmlFor="filter-mobile" className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                    Mobile
                  </label>
                  <input
                    id="filter-mobile"
                    type="tel"
                    value={filterMobile}
                    onChange={(e) => setFilterMobile(e.target.value)}
                    placeholder="e.g. 0429"
                    className="block w-full rounded-md border-2 border-gray-400 bg-white px-2 py-1.5 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500 dark:border-gray-500 dark:bg-gray-900 dark:text-white"
                  />
                </div>
              </div>
              {/* Clear all filters */}
              {(filterState || filterPlace || filterLeader || filterMobile) && (
                <button
                  onClick={() => { setFilterState(''); setFilterPlace(''); setFilterLeader(''); setFilterMobile(''); }}
                  className="text-xs text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
                >
                  ✕ Clear filters
                </button>
              )}
            </div>
          )}

          {/* List of Campaigns */}
          <div className="rounded-lg border-2 border-gray-800 dark:border-gray-600 bg-white shadow-sm dark:bg-gray-800 w-full overflow-hidden">
            <div className="p-4">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                {dateFilter === 'past' && `Past Campaigns (${campaigns.length})`}
                {dateFilter === 'future' && `Future Campaigns (${campaigns.length})`}
              </h2>
            </div>
            <div className="divide-y divide-gray-200 dark:divide-gray-700">
              {campaigns.length === 0 ? (
                <div className="p-4 text-center text-sm text-gray-500 dark:text-gray-400">
                  No campaigns found
                </div>
              ) : (
                (() => {
                  // Group campaigns by date, then state, then place
                  const grouped = campaigns.reduce((acc, campaign) => {
                    const dateKey = campaign.date;
                    if (!acc[dateKey]) {
                      acc[dateKey] = {};
                    }
                    if (!acc[dateKey][campaign.state]) {
                      acc[dateKey][campaign.state] = {};
                    }
                    if (!acc[dateKey][campaign.state][campaign.place]) {
                      acc[dateKey][campaign.state][campaign.place] = [];
                    }
                    acc[dateKey][campaign.state][campaign.place].push(campaign);
                    return acc;
                  }, {} as Record<string, Record<string, Record<string, Campaign[]>>>);

                  // Render grouped campaigns with separate date and state headers
                  const sortedDates = Object.keys(grouped).sort();
                  const result: React.ReactElement[] = [];
                  let lastDate = '';
                  
                  sortedDates.forEach((date) => {
                    const dateCampaigns = grouped[date];
                    const sortedStates = Object.keys(dateCampaigns).sort();
                    
                    // Date header (only show if different from previous)
                    if (date !== lastDate) {
                      result.push(
                        <div key={`date-${date}`} className="bg-yellow-100 dark:bg-yellow-900/30 px-4 py-4 border-2 border-gray-800 dark:border-gray-600 border-b-2 border-yellow-300 dark:border-yellow-700">
                          <div className="font-bold text-xl sm:text-2xl text-yellow-900 dark:text-yellow-200 break-words">
                            {new Date(date).toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
                          </div>
                        </div>
                      );
                      lastDate = date;
                    }
                    
                    sortedStates.forEach((state) => {
                      const stateCampaigns = dateCampaigns[state];
                      const sortedPlaces = Object.keys(stateCampaigns).sort();
                      
                      sortedPlaces.forEach((place) => {
                        const placeCampaigns = stateCampaigns[place];
                        
                        // Campaigns in this place group
                        placeCampaigns.forEach((campaign) => {
                          const isEditing = inlineEditingId === campaign.id;
                          const editData = inlineEditState[campaign.id];
                          
                          if (isEditing && editData) {
                            // Inline editing mode - show editable fields
                            result.push(
                              <div key={campaign.id} className="p-4 bg-blue-50 dark:bg-blue-900/20 border-b-2 border-gray-800 dark:border-gray-600">
                                <div className="space-y-3">
                                  <div className="grid grid-cols-2 gap-2">
                                    <div>
                                      <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                                        Date
                                      </label>
                                      <input
                                        type="date"
                                        value={editData.date}
                                        onChange={(e) => updateInlineEditField(campaign.id, 'date', e.target.value)}
                                        className="w-full rounded-md border-2 border-gray-400 bg-white px-2 py-1 text-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500 dark:border-gray-500 dark:bg-gray-900 dark:text-white"
                                      />
                                    </div>
                                    <div>
                                      <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                                        State
                                      </label>
                                      <select
                                        value={editData.state}
                                        onChange={(e) => updateInlineEditField(campaign.id, 'state', e.target.value)}
                                        disabled={!contextIsAdmin}
                                        className="w-full rounded-md border-2 border-gray-400 bg-white px-2 py-1 text-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500 dark:border-gray-500 dark:bg-gray-900 dark:text-white disabled:opacity-50 disabled:cursor-not-allowed"
                                      >
                                        <option value="">Select state</option>
                                        {AUSTRALIAN_STATES.map((state) => (
                                          <option key={state} value={state}>{state}</option>
                                        ))}
                                      </select>
                                    </div>
                                  </div>
                                  <div className="grid grid-cols-2 gap-2">
                                    <div>
                                      <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                                        Place
                                      </label>
                                      <select
                                        required={!inlineEditOtherPlace[campaign.id]}
                                        value={inlineEditOtherPlace[campaign.id] ? 'OTHER_PLACE' : editData.place}
                                        onChange={(e) => {
                                          if (e.target.value === 'OTHER_PLACE') {
                                            setInlineEditOtherPlace(prev => ({ ...prev, [campaign.id]: true }));
                                            updateInlineEditField(campaign.id, 'place', '');
                                          } else {
                                            setInlineEditOtherPlace(prev => {
                                              const newState = { ...prev };
                                              delete newState[campaign.id];
                                              return newState;
                                            });
                                            setInlineEditCustomPlace(prev => {
                                              const newState = { ...prev };
                                              delete newState[campaign.id];
                                              return newState;
                                            });
                                            updateInlineEditField(campaign.id, 'place', e.target.value);
                                          }
                                        }}
                                        className="w-full rounded-md border-2 border-gray-400 bg-white px-2 py-1 text-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500 dark:border-gray-500 dark:bg-gray-900 dark:text-white"
                                        disabled={!editData.state}
                                      >
                                        <option value="">Select place</option>
                                        {(campaignPlaces[campaign.id] || []).map((place) => (
                                          <option key={place} value={place}>{place}</option>
                                        ))}
                                        <option value="OTHER_PLACE">Other Place</option>
                                      </select>
                                      {inlineEditOtherPlace[campaign.id] && (
                                        <input
                                          type="text"
                                          id={`customPlace_${campaign.id}`}
                                          required
                                          value={inlineEditCustomPlace[campaign.id] || ''}
                                          onChange={(e) => setInlineEditCustomPlace(prev => ({ ...prev, [campaign.id]: e.target.value }))}
                                          placeholder="Enter new place name"
                                          className="mt-2 w-full rounded-md border-2 border-gray-400 bg-white px-2 py-1 text-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500 dark:border-gray-500 dark:bg-gray-900 dark:text-white"
                                        />
                                      )}
                                    </div>
                                    <div>
                                      <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                                        Time
                                      </label>
                                      <select
                                        value={editData.time}
                                        onChange={(e) => updateInlineEditField(campaign.id, 'time', e.target.value)}
                                        className="w-full rounded-md border-2 border-gray-400 bg-white px-2 py-1 text-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500 dark:border-gray-500 dark:bg-gray-900 dark:text-white"
                                      >
                                        <option value="">Select time</option>
                                        {timeOptions.map((time) => (
                                          <option key={time.value} value={time.value}>{time.label}</option>
                                        ))}
                                      </select>
                                    </div>
                                  </div>
                                  <div>
                                    <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                                      Leader
                                    </label>
                                    <select
                                      value={editData.leader}
                                      onChange={(e) => updateInlineEditField(campaign.id, 'leader', e.target.value)}
                                      className="w-full rounded-md border-2 border-gray-400 bg-white px-2 py-1 text-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500 dark:border-gray-500 dark:bg-gray-900 dark:text-white"
                                      disabled={!editData.state}
                                    >
                                      <option value="">Select leader</option>
                                      {(campaignLeaders[campaign.id] || []).map((leader) => (
                                        <option key={leader} value={leader}>{leader}</option>
                                      ))}
                                    </select>
                                  </div>
                                  <div className="grid grid-cols-2 gap-2">
                                    <div>
                                      <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                                        Mobile
                                      </label>
                                      <input
                                        type="tel"
                                        value={editData.mobile}
                                        onChange={(e) => updateInlineEditField(campaign.id, 'mobile', e.target.value)}
                                        className="w-full rounded-md border-2 border-gray-400 bg-white px-2 py-1 text-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500 dark:border-gray-500 dark:bg-gray-900 dark:text-white"
                                        placeholder="Mobile (optional)"
                                      />
                                    </div>
                                    <div>
                                      <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                                        Category
                                      </label>
                                      <select
                                        value={editData.category}
                                        onChange={(e) => updateInlineEditField(campaign.id, 'category', e.target.value)}
                                        className="w-full rounded-md border-2 border-gray-400 bg-white px-2 py-1 text-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500 dark:border-gray-500 dark:bg-gray-900 dark:text-white"
                                      >
                                        {campaignCategories.map((cat) => (
                                          <option key={cat.code} value={cat.code}>{cat.name}</option>
                                        ))}
                                      </select>
                                    </div>
                                  </div>

                                  <div className="flex gap-2 pt-2">
                                    <button
                                      onClick={() => handleSaveInlineEdit(campaign.id)}
                                      className="flex-1 rounded-md bg-green-600 px-3 py-2 text-base font-bold text-white hover:bg-green-700 border-2 border-gray-800 dark:border-gray-600"
                                    >
                                      Save
                                    </button>
                                    <button
                                      onClick={handleCancelInlineEdit}
                                      className="flex-1 rounded-md bg-gray-200 px-3 py-2 text-base font-bold text-gray-700 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600 border-2 border-gray-800 dark:border-gray-600"
                                    >
                                      Cancel
                                    </button>
                                  </div>
                                </div>
                              </div>
                            );
                          } else {
                            // Display mode - show read-only fields
                            const displayTime = formatCampaignTimeDisplay(campaign.time);
                            
                            // Show category badge for all non-TWOL campaigns
                            const campaignCat = campaign.category ?? 'TWOL';
                            const showCategoryBadge = campaignCat !== 'TWOL';

                            // Get state color for campaign line
                            const stateColor = getStateColor(campaign.state);

                            result.push(
                              <div key={campaign.id} className={`p-4 sm:p-5 ${stateColor.bg} border-b-2 border-gray-800 dark:border-gray-600`}>
                                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                                  <div className="flex-1 min-w-0">
                                    {/* Top line: Place State • Time, with category badge right-justified */}
                                    <div className={`flex items-center justify-between gap-2 text-lg sm:text-xl font-bold ${stateColor.text} mb-2 break-words`}>
                                      <span>
                                        {place} {campaign.state} • {displayTime}
                                      </span>
                                      {showCategoryBadge && (
                                        <span className="shrink-0 ml-2">{campaignCat}</span>
                                      )}
                                    </div>
                                    {/* Leader (bold) and mobile (normal) on same line */}
                                    <div className={`text-base sm:text-lg ${stateColor.text} opacity-90 mb-1 break-words`}>
                                      <span className="font-semibold">Leader: </span>
                                      <span className="font-bold">{campaign.leader}</span>
                                      {campaign.mobile ? (
                                        <>
                                          {' '}
                                          <span className="font-normal">{campaign.mobile}</span>
                                        </>
                                      ) : null}
                                      {contextIsAdmin && campaign.source && (
                                        <span className="ml-2 text-xs font-normal opacity-75" title={campaign.source === 'MAN' ? 'Manual' : campaign.source === 'CFP' ? 'Copied from past week' : campaign.source === 'RUL' ? 'Created by rule' : campaign.source}>
                                          ({campaign.source})
                                        </span>
                                      )}
                                    </div>
                                    {/* This Campaign is Correct checkbox: shown only for Future campaigns */}
                                    {dateFilter === 'future' && (
                                      <div className="flex gap-6 justify-center text-sm sm:text-base mt-2 mb-2">
                                        <div className={`flex items-center ${stateColor.text} font-semibold cursor-pointer`} onClick={() => handleToggleCheckbox(campaign.id, 'tl_ok', campaign.tl_ok)}>
                                          <input
                                            type="checkbox"
                                            checked={campaign.tl_ok}
                                            onChange={() => {}}
                                            className="h-5 w-5 rounded border-gray-300 mr-2 cursor-pointer"
                                          />
                                          <span>This Campaign is Correct</span>
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                  <div className="flex flex-row gap-2 sm:ml-4 w-full sm:w-auto">
                                    {/* Show Record Results only if campaign date+time is in the past (same as Past tab) AND
                                        (full admin OR state reporter for same state OR own campaign OR shared with me) */}
                                    {(() => {
                                      const isPast = isCampaignPast(campaign.date, campaign.time);
                                      if (!isPast) return false;
                                      if (adminStatus === 'AD') return true;
                                      // State reporters can record results for any past campaign in their state
                                      if (adminStatus === 'SR' && (campaign.state || '').toUpperCase().trim() === (userState || '').toUpperCase().trim()) return true;
                                      const isOwn = userMobileAndLeader?.leader && userState && normalizeName(campaign.leader || '') === normalizeName(userMobileAndLeader.leader) && (campaign.state || '').toUpperCase().trim() === (userState || '').toUpperCase().trim() && userMobileAndLeader.mobile && normalizeMobile(campaign.mobile || '') === normalizeMobile(userMobileAndLeader.mobile);
                                      const isShared = sharedWithMeOwners.some((o) => (o.owner_state || '').toUpperCase().trim() === (campaign.state || '').toUpperCase().trim() && normalizeName(o.owner_leader) === normalizeName(campaign.leader || ''));
                                      return isOwn || isShared;
                                    })() && (
                                      <button
                                        onClick={() => {
                                          // Navigate to record results detail page with campaign data and current filter
                                          const params = new URLSearchParams({
                                            date: campaign.date,
                                            state: campaign.state,
                                            place: campaign.place,
                                            time: campaign.time,
                                            leader: campaign.leader,
                                            returnFilter: dateFilter,
                                          });
                                          router.push(`/record-results/detail?${params.toString()}`);
                                        }}
                                        className="flex-1 rounded-md bg-green-100 px-2 sm:px-4 py-2 text-base font-bold text-green-700 hover:bg-green-200 dark:bg-green-900/30 dark:text-green-300 dark:hover:bg-green-900/50 border-2 border-gray-800 dark:border-gray-600"
                                      >
                                        Record Results
                                      </button>
                                    )}
                                    <button
                                      onClick={() => handleEdit(campaign)}
                                      className="flex-1 rounded-md bg-blue-100 px-2 sm:px-4 py-2 text-base font-bold text-blue-700 hover:bg-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:hover:bg-blue-900/50 border-2 border-gray-800 dark:border-gray-600"
                                    >
                                      Edit
                                    </button>
                                    <button
                                      onClick={() => handleDelete(campaign.id)}
                                      className="flex-1 rounded-md bg-red-100 px-2 sm:px-4 py-2 text-base font-bold text-red-700 hover:bg-red-200 dark:bg-red-900/30 dark:text-red-300 dark:hover:bg-red-900/50 border-2 border-gray-800 dark:border-gray-600"
                                    >
                                      Delete
                                    </button>
                                  </div>
                                </div>
                              </div>
                            );
                          }
                        });
                      });
                    });
                  });
                  
                  return result;
                })()
              )}
            </div>
          </div>
        </div>
      </div>
    </MobileLayout>
  );
}

export default function AppPage() {
  return (
    <Suspense fallback={
      <MobileLayout>
        <div className="flex min-h-screen items-center justify-center">
          <div className="text-gray-600 dark:text-gray-400">Loading...</div>
        </div>
      </MobileLayout>
    }>
      <AppPageContent />
    </Suspense>
  );
}
