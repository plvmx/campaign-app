'use client';

import { useEffect, useState, useRef, Suspense, useMemo, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import MobileLayout from '@/components/MobileLayout';
import { getCurrentUser } from '@/lib/auth';
import { supabase } from '@/lib/supabaseClient';
import { getUserProfile, upsertUserProfile, UserProfile } from '@/lib/userProfile';
import { getUserStateCode } from '@/lib/location';
import { normalizeName, normalizeMobile } from '@/lib/auth';
import { hasPermission, Permission } from '@/lib/permissions';
import { useCampaignDates } from '@/contexts/CampaignDatesContext';
import { formatDateForDb } from '@/lib/campaignDates';
import { getStateColor } from '@/lib/stateColors';
import { logCampaignChange, fetchCampaignData } from '@/lib/campaignLog';

const AUSTRALIAN_STATES = ['ACT', 'NSW', 'QLD', 'SA', 'TAS', 'VIC', 'WA', 'NT'];

interface Campaign {
  id: string;
  date: string;
  state: string;
  place: string;
  time: string;
  leader: string;
  mobile: string | null;
  botj: string | null;
  tl_ok: boolean;
  sr_ok: boolean;
  created_at: string;
}

function AppPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { dates: campaignDates } = useCampaignDates();
  const [user, setUser] = useState<any>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState<boolean>(false);
  const [adminStatus, setAdminStatus] = useState<string | null>(null); // Store admin status from state_leaders table
  const [userState, setUserState] = useState<string | null>(null); // Store user's state from state_leaders table
  const [userMobileAndLeader, setUserMobileAndLeader] = useState<{ mobile: string | null; leader: string | null } | null>(null); // Store user's mobile and leader for Record Results button visibility
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
    botj: string;
    tl_ok: boolean;
    sr_ok: boolean;
  }>>({});
  // Get today's date in YYYY-MM-DD format for default value and min attribute
  const getTodayDateString = () => {
    return formatDateForDb(new Date());
  };

  const [formState, setFormState] = useState({
    date: getTodayDateString(),
    state: '',
    place: '',
    time: '',
    leader: '',
    mobile: '',
    botj: 'No',
    tl_ok: false,
    sr_ok: false,
  });
  const [filterState, setFilterState] = useState<string>('');
  const [isFormExpanded, setIsFormExpanded] = useState<boolean>(false);
  const [dateFilter, setDateFilter] = useState<'past' | 'future'>('future');
  
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
    if (!user) return;
    
    const { getUserAdminStatusAndMobile } = await import('@/lib/campaignFilter');
    const { normalizeMobile } = await import('@/lib/auth');
    const { admin: adminStatusValue, state: userStateValue, mobile, leader } = await getUserAdminStatusAndMobile();
    const userMobileAndLeaderData = mobile && leader ? { mobile, leader } : null;
    
    // Update state variables
    setAdminStatus(adminStatusValue);
    setUserState(userStateValue);
    
    let query = supabase.from('campaigns').select('*');
    
    if (adminStatusValue === 'AD') {
      // No filter
    } else if (adminStatusValue === 'SR') {
      if (userStateValue) {
        query = query.eq('state', userStateValue.toUpperCase().trim());
      } else {
        query = query.eq('user_id', user.id);
      }
    } else {
      if (userMobileAndLeaderData?.mobile && userMobileAndLeaderData?.leader) {
        query = query.eq('leader', userMobileAndLeaderData.leader);
      } else {
        query = query.eq('user_id', user.id);
      }
    }
    
    const { data, error: fetchError } = await query
      .order('date', { ascending: true })
      .order('state', { ascending: true })
      .order('place', { ascending: true })
      .order('time', { ascending: true });
    
    if (fetchError) throw fetchError;
    
    let filteredData = data || [];
    if (adminStatusValue !== 'AD' && adminStatusValue !== 'SR') {
      if (userMobileAndLeaderData?.mobile) {
        const normalizedMobile = normalizeMobile(userMobileAndLeaderData.mobile);
        filteredData = filteredData.filter(campaign => 
          campaign.mobile && normalizeMobile(campaign.mobile) === normalizedMobile
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
  }, [user, filterState, applyDateFilter]);
  
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
          // Load from database and cache
          async function loadPlacesForEdit() {
            const { data, error } = await supabase
              .from('state_places')
              .select('place')
              .eq('state', normalizedState)
              .order('place', { ascending: true });
            
            if (error) {
              console.error('Error loading places:', error);
              return;
            }
            
            if (data) {
              const uniquePlaces = Array.from(new Set(data.map(p => p.place).filter(Boolean)));
              // Cache the result
              placesCache.current[normalizedState] = uniquePlaces;
              setCampaignPlaces(prev => ({
                ...prev,
                [campaignId]: uniquePlaces,
              }));
            }
          }
          loadPlacesForEdit();
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
          // Load from database and cache
          async function loadLeadersForEdit() {
            const { data, error } = await supabase
              .from('state_leaders')
              .select('leader')
              .eq('state', normalizedState)
              .order('leader', { ascending: true });
            
            if (error) {
              console.error('Error loading leaders:', error);
              return;
            }
            
            if (data) {
              const uniqueLeaders = Array.from(new Set(data.map(l => l.leader).filter(Boolean)));
              // Cache the result
              leadersCache.current[normalizedState] = uniqueLeaders;
              setCampaignLeaders(prev => ({
                ...prev,
                [campaignId]: uniqueLeaders,
              }));
            }
          }
          loadLeadersForEdit();
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
  const [availableDates, setAvailableDates] = useState<{ value: string; label: string }[]>([]);
  const [timeOptions, setTimeOptions] = useState<{ value: string; label: string }[]>([]);
  const [loadingPlaces, setLoadingPlaces] = useState(false);
  const [loadingLeaders, setLoadingLeaders] = useState(false);
  const isEditingRef = useRef(false); // Flag to prevent useEffect interference during edit
  const pendingEditDataRef = useRef<{ campaign: Campaign; timeValue: string } | null>(null); // Store campaign data for edit

  useEffect(() => {
    async function checkAuthAndLoadCampaigns() {
      try {
        const currentUser = await getCurrentUser();
        if (!currentUser) {
          router.push('/login');
          return;
        }
        setUser(currentUser);

        // Parallelize independent operations
        const { getUserAdminStatusAndMobile } = await import('@/lib/campaignFilter');
        const { normalizeMobile } = await import('@/lib/auth');
        
        // Load profile and check for pending first name in parallel
        const [profile, pendingFirstName] = await Promise.all([
          getUserProfile(),
          Promise.resolve(sessionStorage.getItem('pendingFirstName'))
        ]);
        
        // Handle new user profile creation if needed
        let finalProfile = profile;
        if (!profile && pendingFirstName) {
          // New user - create profile with first name and state (if permission given)
          try {
            let stateCode: string | null = null;
            
            // Try to get user's state (this will request location permission)
            try {
              stateCode = await getUserStateCode();
            } catch (locationError) {
              // User denied location permission or error occurred
              console.log('Location permission not granted or error occurred');
            }
            
            // Create profile with name and state (if available)
            finalProfile = await upsertUserProfile({
              name: pendingFirstName,
              state: stateCode,
            });
            
            // Clear the pending first name from sessionStorage
            sessionStorage.removeItem('pendingFirstName');
          } catch (profileError) {
            console.error('Error creating user profile:', profileError);
            // Continue even if profile creation fails
          }
        }
        
        // Store profile in state for display
        if (finalProfile) {
          setUserProfile(finalProfile);
        }
        
        // Parallelize: Get admin status/mobile/leader and check admin permission
        // Note: getUserAdminStatusAndMobile needs profile, so we do it after profile is ready
        const [adminData, adminAccess] = await Promise.all([
          getUserAdminStatusAndMobile(),
          hasPermission(Permission.ADMIN_ACCESS)
        ]);
        
        const { admin: adminStatus, state: userStateValue, mobile, leader } = adminData;
        const userMobileAndLeaderData = mobile && leader ? { mobile, leader } : null;
        
        setIsAdmin(adminAccess);
        setAdminStatus(adminStatus);
        setUserState(userStateValue);
        setUserMobileAndLeader(userMobileAndLeaderData);
        
        console.log('State Reporter Debug:', { 
          adminStatus, 
          userStateValue,
          userProfileState: finalProfile?.state,
          adminAccess,
          hasAdminPermission: adminAccess,
          userMobileAndLeader: userMobileAndLeaderData,
          willShowButton: adminStatus === 'SR' && (userStateValue || finalProfile?.state) ? 'YES' : 'NO',
          buttonCondition: {
            adminStatusIsSR: adminStatus === 'SR',
            hasUserState: !!userStateValue,
            hasProfileState: !!finalProfile?.state,
            willShow: adminStatus === 'SR' && (userStateValue || finalProfile?.state)
          }
        });
        
        // Check if returning from a filtered view (URL parameter takes precedence)
        const filterParam = searchParams.get('filter');
        if (filterParam && (filterParam === 'past' || filterParam === 'future')) {
          setDateFilter(filterParam as 'past' | 'future');
          // Clean up the URL parameter
          router.replace('/app', { scroll: false });
        } else {
          // Set default filter: 'future' for all users
          setDateFilter('future');
        }

        // Check for success parameter from campaign creation
        if (searchParams.get('created') === 'true') {
          setShowSuccess(true);
          // Remove the parameter from URL without reload
          router.replace('/app', { scroll: false });
          // Hide success message after 5 seconds
          setTimeout(() => setShowSuccess(false), 5000);
        }
        
        console.log('Campaign filtering:', { adminStatus, userState: userStateValue, userMobileAndLeader: userMobileAndLeaderData });
        
        // Performance logging
        const queryStartTime = performance.now();
        
        let query = supabase
          .from('campaigns')
          .select('*');
        
        // Apply filtering based on admin status
        if (adminStatus === 'AD') {
          // Admin: no filter, see all campaigns
          // Query remains as is (no filters applied)
          console.log('Filter: AD - showing all campaigns');
        } else if (adminStatus === 'SR') {
          // State Reporter: filter by state only (no name filter)
          if (userStateValue) {
            // Normalize state to uppercase for matching
            const normalizedState = userStateValue.toUpperCase().trim();
            query = query.eq('state', normalizedState);
            console.log('Filter: SR - filtering by state:', normalizedState);
          } else {
            // If no state found, fallback to user_id
            console.log('Filter: SR - no state found, using user_id fallback');
            query = query.eq('user_id', currentUser.id);
          }
        } else {
          // Regular user: filter by name and mobile match
          if (userMobileAndLeaderData?.mobile && userMobileAndLeaderData?.leader) {
            // Filter by leader name
            query = query.eq('leader', userMobileAndLeaderData.leader);
            console.log('Filter: Regular user - filtering by leader:', userMobileAndLeaderData.leader);
          } else {
            // Fallback to user_id if mobile/leader not available
            console.log('Filter: Regular user - no mobile/leader, using user_id fallback');
            query = query.eq('user_id', currentUser.id);
          }
        }
        
        const { data, error } = await query
          .order('date', { ascending: true })
          .order('state', { ascending: true })
          .order('place', { ascending: true })
          .order('time', { ascending: true });

        if (error) throw error;
        
        // Performance logging
        const queryEndTime = performance.now();
        const queryDuration = queryEndTime - queryStartTime;
        console.log(`[Performance] Campaign query took ${queryDuration.toFixed(2)}ms, returned ${data?.length || 0} campaigns`);
        
        // Additional filtering for regular users (mobile match)
        // SR users should see ALL campaigns for their state, so no additional filtering
        let filteredData = data || [];
        if (adminStatus !== 'AD' && adminStatus !== 'SR') {
          // Regular user: also filter by normalized mobile
          if (userMobileAndLeaderData?.mobile) {
            const normalizedMobile = normalizeMobile(userMobileAndLeaderData.mobile);
            filteredData = filteredData.filter(campaign => 
              campaign.mobile && normalizeMobile(campaign.mobile) === normalizedMobile
            );
          }
        }
        
        // Store all campaigns (unfiltered by state and date filter)
        // The memoized filteredCampaigns will automatically update via useEffect
        setAllCampaigns(filteredData);
        
        // Load dropdown data
        await loadDropdownData();
      } catch (error) {
        router.push('/login');
      } finally {
        setIsLoading(false);
      }
    }
    
    async function loadDropdownData() {
      // Load time options for dropdowns
      try {
        // Generate time options (8:00 AM to 8:00 PM, half-hour intervals)
        const times: { value: string; label: string }[] = [];
        for (let hour = 8; hour <= 20; hour++) {
          for (let minute = 0; minute < 60; minute += 30) {
            const timeStr = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
            const displayHour = hour % 12 || 12;
            const ampm = hour >= 12 ? 'PM' : 'AM';
            times.push({
              value: timeStr,
              label: `${displayHour}:${minute.toString().padStart(2, '0')} ${ampm}`,
            });
          }
        }
        setTimeOptions(times);
      } catch (err) {
        console.error('Error loading dropdown data:', err);
      }
    }
    
    checkAuthAndLoadCampaigns();
  }, [router, searchParams]);

  // Update available dates when campaign dates change
  useEffect(() => {
    if (campaignDates) {
      const dates: { value: string; label: string }[] = [];
      
      // Start from Past Campaign Start
      const startDate = new Date(campaignDates.pastCampaignStart);
      
      // End on Sunday after Second Week Start
      const endDate = new Date(campaignDates.secondWeekStart);
      endDate.setDate(endDate.getDate() + 6); // Add 6 days to get to Sunday
      
      // Generate all dates in the range
      const currentDate = new Date(startDate);
      while (currentDate <= endDate) {
        const dateStr = formatDateForDb(currentDate);
        dates.push({
          value: dateStr,
          label: currentDate.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' }),
        });
        currentDate.setDate(currentDate.getDate() + 1);
      }
      
      setAvailableDates(dates);
    }
  }, [campaignDates]);
  
  // Memoize filtered campaigns to avoid recalculating on every render
  const filteredCampaigns = useMemo(() => {
    if (allCampaigns.length === 0) return [];
    
    let filtered = allCampaigns;
    
    // Apply state filter if set
    if (filterState) {
      filtered = filtered.filter(c => c.state.toUpperCase() === filterState.toUpperCase());
    }
    
    // Apply date filter
    filtered = applyDateFilter(filtered);
    
    return filtered;
  }, [allCampaigns, filterState, applyDateFilter]);

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
      try {
        const { data, error } = await supabase
          .from('state_places')
          .select('place')
          .eq('state', normalizedState)
          .order('place', { ascending: true });
        
        if (error) throw error;
        
        const uniquePlaces = Array.from(new Set((data || []).map(p => p.place).filter(Boolean)));
        // Cache the result
        placesCache.current[normalizedState] = uniquePlaces;
        setPlaces(uniquePlaces);
      } catch (err) {
        console.error('Error loading places:', err);
      } finally {
        setLoadingPlaces(false);
      }
    }
    
    loadPlaces();
  }, [formState.state]);
  
  // Load leaders from state_leaders table when state changes (with caching)
  useEffect(() => {
    // Skip if we're in the middle of editing (loading data programmatically)
    if (isEditingRef.current) {
      return;
    }
    
    async function loadLeaders() {
      if (!formState.state) {
        setLeaders([]);
        return;
      }
      
      const normalizedState = formState.state.toUpperCase().trim();
      
      // Check cache first
      if (leadersCache.current[normalizedState]) {
        setLeaders(leadersCache.current[normalizedState]);
        return;
      }
      
      setLoadingLeaders(true);
      try {
        const { data, error } = await supabase
          .from('state_leaders')
          .select('leader')
          .eq('state', normalizedState)
          .order('leader', { ascending: true });
        
        if (error) throw error;
        
        const uniqueLeaders = Array.from(new Set((data || []).map(l => l.leader).filter(Boolean)));
        // Cache the result
        leadersCache.current[normalizedState] = uniqueLeaders;
        setLeaders(uniqueLeaders);
      } catch (err) {
        console.error('Error loading leaders:', err);
      } finally {
        setLoadingLeaders(false);
      }
    }
    
    loadLeaders();
  }, [formState.state]);
  
  // Set default state from user profile when profile is loaded
  useEffect(() => {
    if (userProfile?.state && !formState.state) {
      const userState = userProfile.state;
      if (userState) {
        setFormState(prev => ({
          ...prev,
          state: userState.toUpperCase().trim(),
        }));
      }
    }
  }, [userProfile]);
  
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
          botj: campaign.botj || 'No',
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
      const user = await getCurrentUser();
      if (!user) {
        throw new Error('You must be logged in');
      }
      
      // Handle "Other Place" - insert into state_places table if needed
      let placeValue = formState.place;
      if (isOtherPlace && customPlace.trim()) {
        if (!formState.state || !formState.state.trim()) {
          throw new Error('Please select a state before entering a new place');
        }
        
        const newPlace = customPlace.trim();
        const stateValue = formState.state.toUpperCase().trim();
        
        // Insert new place into state_places table
        const { error: placeError } = await supabase
          .from('state_places')
          .insert([{ 
            state: stateValue, 
            place: newPlace 
          }]);
        
        // If it's a duplicate (unique constraint violation), that's okay - just use the place name
        if (placeError) {
          if (placeError.code === '23505') {
            // Duplicate entry - that's fine, the place already exists
            console.log(`Place "${newPlace}" already exists for state "${stateValue}"`);
          } else {
            console.error('Error inserting place:', placeError);
            throw new Error(`Failed to add new place: ${placeError.message}`);
          }
        }
        
        placeValue = newPlace;
        
        // Reload places for the state and update cache
        const { data: placesData } = await supabase
          .from('state_places')
          .select('place')
          .eq('state', stateValue)
          .order('place', { ascending: true });
        
        if (placesData) {
          const uniquePlaces = Array.from(new Set(placesData.map(p => p.place).filter(Boolean)));
          // Update cache
          placesCache.current[stateValue] = uniquePlaces;
          setPlaces(uniquePlaces);
        }
      }
      
      // Validate that we have a place value
      if (!placeValue || placeValue.trim() === '') {
        throw new Error('Please select or enter a place');
      }
      
      const mobileValue = formState.mobile.trim() || null;
      
      const newCampaignData = {
        date: formState.date,
        state: formState.state,
        place: placeValue,
        time: formState.time,
        leader: formState.leader,
        mobile: mobileValue,
        botj: formState.botj || 'No',
        tl_ok: formState.tl_ok,
        sr_ok: formState.sr_ok,
        user_id: user.id,
        created_at: new Date().toISOString(),
      };
      
      // Create new campaign
      const { data: insertedData, error } = await supabase
        .from('campaigns')
        .insert([newCampaignData])
        .select()
        .single();
        
      if (error) throw error;
      
      // Log the insertion (async, won't block)
      if (insertedData) {
        logCampaignChange(insertedData.id, 'INSERT', null, insertedData);
      }
      
      setSuccess('Campaign created successfully');
      
      // Reset form and reload
      setFormState({ date: '', state: '', place: '', time: '', leader: '', mobile: '', botj: 'No', tl_ok: false, sr_ok: false });
      setIsOtherPlace(false);
      setCustomPlace('');
      setIsFormExpanded(false); // Collapse form after successful save
      
      // Reload campaigns using optimized function
      await refetchCampaigns();
    } catch (err: any) {
      setError(err.message || 'Failed to save campaign');
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
        try {
          const { data, error } = await supabase
            .from('state_places')
            .select('place')
            .eq('state', normalizedState)
            .order('place', { ascending: true });
          
          if (!error && data) {
            const uniquePlaces = Array.from(new Set(data.map(p => p.place).filter(Boolean)));
            // Cache the result
            placesCache.current[normalizedState] = uniquePlaces;
            setCampaignPlaces(prev => ({
              ...prev,
              [campaign.id]: uniquePlaces,
            }));
          }
        } catch (err) {
          console.error('Error loading places:', err);
        }
      }
      
      // Load leaders for the state from state_leaders table (with caching)
      // Check cache first
      if (leadersCache.current[normalizedState]) {
        setCampaignLeaders(prev => ({
          ...prev,
          [campaign.id]: leadersCache.current[normalizedState],
        }));
      } else {
        try {
          const { data, error } = await supabase
            .from('state_leaders')
            .select('leader')
            .eq('state', normalizedState)
            .order('leader', { ascending: true });
          
          if (!error && data) {
            const uniqueLeaders = Array.from(new Set(data.map(l => l.leader).filter(Boolean)));
            // Cache the result
            leadersCache.current[normalizedState] = uniqueLeaders;
            setCampaignLeaders(prev => ({
              ...prev,
              [campaign.id]: uniqueLeaders,
            }));
          }
        } catch (err) {
          console.error('Error loading leaders:', err);
        }
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
        botj: campaign.botj || 'No',
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
      const user = await getCurrentUser();
      if (!user) {
        throw new Error('You must be logged in');
      }
      
      // Handle "Other Place" - insert into state_places table if needed
      let placeValue = editData.place;
      const isOther = inlineEditOtherPlace[campaignId];
      const customPlaceValue = inlineEditCustomPlace[campaignId];
      
      if (isOther && customPlaceValue && customPlaceValue.trim()) {
        if (!editData.state || !editData.state.trim()) {
          throw new Error('Please select a state before entering a new place');
        }
        
        const newPlace = customPlaceValue.trim();
        const stateValue = editData.state.toUpperCase().trim();
        
        // Insert new place into state_places table
        const { error: placeError } = await supabase
          .from('state_places')
          .insert([{ 
            state: stateValue, 
            place: newPlace 
          }]);
        
        // If it's a duplicate (unique constraint violation), that's okay - just use the place name
        if (placeError) {
          if (placeError.code === '23505') {
            // Duplicate entry - that's fine, the place already exists
            console.log(`Place "${newPlace}" already exists for state "${stateValue}"`);
          } else {
            console.error('Error inserting place:', placeError);
            throw new Error(`Failed to add new place: ${placeError.message}`);
          }
        }
        
        placeValue = newPlace;
        
        // Reload places for the state and update cache
        const { data: placesData } = await supabase
          .from('state_places')
          .select('place')
          .eq('state', stateValue)
          .order('place', { ascending: true });
        
        if (placesData) {
          const uniquePlaces = Array.from(new Set(placesData.map(p => p.place).filter(Boolean)));
          // Update cache
          placesCache.current[stateValue] = uniquePlaces;
          setCampaignPlaces(prev => ({
            ...prev,
            [campaignId]: uniquePlaces,
          }));
        }
      }
      
      // Validate that we have a place value
      if (!placeValue || placeValue.trim() === '') {
        throw new Error('Please select or enter a place');
      }
      
      // Fetch old data for logging
      const oldData = await fetchCampaignData(campaignId);
      
      const mobileValue = editData.mobile.trim() || null;
      
      const newData = {
        date: editData.date,
        state: editData.state,
        place: placeValue,
        time: editData.time,
        leader: editData.leader,
        mobile: mobileValue,
        botj: editData.botj || 'No',
        tl_ok: editData.tl_ok,
        sr_ok: editData.sr_ok,
      };
      
      const { error } = await supabase
        .from('campaigns')
        .update(newData)
        .eq('id', campaignId);
      
      if (error) throw error;
      
      // Log the change (async, won't block)
      if (oldData) {
        logCampaignChange(campaignId, 'UPDATE', oldData, newData);
      }
      
      setSuccess('Campaign updated successfully');
      setInlineEditingId(null);
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
      
      // Reload campaigns using optimized function
      await refetchCampaigns();
    } catch (err: any) {
      setError(err.message || 'Failed to update campaign');
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
          try {
            const { data, error } = await supabase
              .from('state_leaders')
              .select('mobile')
              .eq('state', editData.state.toUpperCase().trim())
              .eq('leader', value)
              .single();
            
            if (!error && data && data.mobile) {
              // Update both leader and mobile
              setInlineEditState(prev => ({
                ...prev,
                [campaignId]: {
                  ...prev[campaignId],
                  leader: value,
                  mobile: data.mobile || '',
                }
              }));
              return;
            }
          } catch (err) {
            console.error('Error loading mobile for leader:', err);
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
    if (!confirm('Are you sure you want to delete this campaign?')) {
      return;
    }
    
    try {
      // Fetch old data for logging before deletion
      const oldData = await fetchCampaignData(id);
      
      const { error } = await supabase.from('campaigns').delete().eq('id', id);
      if (error) throw error;
      
      // Log the deletion (async, won't block)
      if (oldData) {
        logCampaignChange(id, 'DELETE', oldData, null);
      }
      
      setSuccess('Campaign deleted successfully');
      
      // Reload campaigns using optimized function
      await refetchCampaigns();
    } catch (err: any) {
      setError(err.message || 'Failed to delete campaign');
    }
  };

  const handleToggleCheckbox = async (campaignId: string, field: 'tl_ok' | 'sr_ok', currentValue: boolean) => {
    const newValue = !currentValue;
    
    // Optimistic update: update UI immediately for better UX
    setCampaigns(prev => prev.map(campaign => 
      campaign.id === campaignId 
        ? { ...campaign, [field]: newValue }
        : campaign
    ));

    setAllCampaigns(prev => prev.map(campaign => 
      campaign.id === campaignId 
        ? { ...campaign, [field]: newValue }
        : campaign
    ));
    
    try {
      // Fetch old data for logging (in parallel with update)
      const [oldData] = await Promise.all([
        fetchCampaignData(campaignId)
      ]);
      
      const newData = { [field]: newValue };
      
      // Update database
      const { error } = await supabase
        .from('campaigns')
        .update(newData)
        .eq('id', campaignId);

      if (error) {
        // Rollback optimistic update on error
        setCampaigns(prev => prev.map(campaign => 
          campaign.id === campaignId 
            ? { ...campaign, [field]: currentValue }
            : campaign
        ));
        setAllCampaigns(prev => prev.map(campaign => 
          campaign.id === campaignId 
            ? { ...campaign, [field]: currentValue }
            : campaign
        ));
        throw error;
      }
      
      // Log the change (async, won't block)
      if (oldData) {
        logCampaignChange(campaignId, 'UPDATE', oldData, { ...oldData, ...newData });
      }
    } catch (err: any) {
      setError(err.message || 'Failed to update verification status');
    }
  };
  

  if (isLoading) {
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
            {userProfile?.name ? (() => {
              // Remove underscore and everything after it for display only
              const displayName = userProfile.name.includes('_') 
                ? userProfile.name.split('_')[0] 
                : userProfile.name;
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
                  ? 'Please check all campaign details carefully. If any details are not correct use the Edit, Delete and Create buttons to make any changes necessary. When you have finished please confirm by clicking on the "This Campaign is Correct" checkbox'
                  : adminStatus !== 'AD'
                  ? 'As a team leader you can perform two main functions here. Firstly you can record results (names of persons that you and your team have presented the gospel to) by clicking on the "Record Results" button. Secondly you can check and confirm that all details relating to your upcoming campaigns are correct. If any details are not correct use the Edit, Delete and Create buttons to make any changes necessary. When you have finished please confirm by clicking on the "This Campaign is Correct" checkbox.'
                  : 'More info to come soon'
                }
              </div>
            )}
          </div>
          
          {/* Date Filter Buttons */}
          <div className="mt-4 flex justify-center gap-3 flex-wrap">
            <button
              onClick={() => setDateFilter('past')}
              className={`rounded-md px-4 py-2 text-base font-bold transition-colors shadow-sm border-2 border-gray-800 dark:border-gray-600 ${
                dateFilter === 'past'
                  ? 'bg-blue-600 text-white shadow-md'
                  : 'bg-gradient-to-b from-gray-100 to-gray-200 text-gray-700 hover:from-gray-200 hover:to-gray-300 dark:from-gray-700 dark:to-gray-800 dark:text-gray-300 dark:hover:from-gray-600 dark:hover:to-gray-700'
              }`}
            >
              Past
            </button>
            <button
              onClick={() => setDateFilter('future')}
              className={`rounded-md px-4 py-2 text-base font-bold transition-colors shadow-sm border-2 border-gray-800 dark:border-gray-600 ${
                dateFilter === 'future'
                  ? 'bg-blue-600 text-white shadow-md'
                  : 'bg-gradient-to-b from-gray-100 to-gray-200 text-gray-700 hover:from-gray-200 hover:to-gray-300 dark:from-gray-700 dark:to-gray-800 dark:text-gray-300 dark:hover:from-gray-600 dark:hover:to-gray-700'
              }`}
            >
              Future
            </button>
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
            {adminStatus === 'SR' && (userState || userProfile?.state) && (
              <button
                type="button"
                onClick={() => {
                  const stateToUse = userState || userProfile?.state || '';
                  console.log('Navigating to campaign rules with state:', stateToUse);
                  router.push(`/admin/campaign-rules?state=${encodeURIComponent(stateToUse)}`);
                }}
                className="rounded-md bg-blue-600 px-4 py-2 text-base font-bold text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 border-2 border-gray-800 dark:border-gray-600"
              >
                Manage Campaign Rules
              </button>
            )}
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
                  disabled={!isAdmin}
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
                      try {
                        const { data, error } = await supabase
                          .from('state_leaders')
                          .select('mobile')
                          .eq('state', formState.state.toUpperCase().trim())
                          .eq('leader', newLeader)
                          .single();
                        
                        if (!error && data && data.mobile) {
                          setFormState({ ...formState, leader: newLeader, mobile: data.mobile || '' });
                        } else {
                          setFormState({ ...formState, leader: newLeader });
                        }
                      } catch (err) {
                        console.error('Error loading mobile for leader:', err);
                        setFormState({ ...formState, leader: newLeader });
                      }
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
                <label htmlFor="botj" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                  BOTJ
                </label>
                <select
                  id="botj"
                  required
                  value={formState.botj}
                  onChange={(e) => setFormState({ ...formState, botj: e.target.value })}
                  className="mt-1 block w-full rounded-md border-2 border-gray-400 bg-white px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500 dark:border-gray-500 dark:bg-gray-900 dark:text-white"
                >
                  <option value="No">No</option>
                  <option value="Yes">Yes</option>
                </select>
              </div>
              
              <div className="flex gap-6 justify-center">
                {/* TL OK checkbox: shown for all users */}
                <div className="flex items-center">
                  <input
                    id="tl_ok"
                    type="checkbox"
                    checked={formState.tl_ok}
                    onChange={(e) => setFormState({ ...formState, tl_ok: e.target.checked })}
                    className="h-5 w-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  <label htmlFor="tl_ok" className="ml-2 text-base font-semibold text-gray-700 dark:text-gray-300">
                    This Campaign is Correct
                  </label>
                </div>
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

          {/* Filter - Only show for admin users */}
          {isAdmin && (
            <div className="w-full">
              <label htmlFor="filter" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                Filter by State
              </label>
              <select
                id="filter"
                value={filterState}
                onChange={(e) => setFilterState(e.target.value)}
                className="mt-1 block w-full rounded-md border-2 border-gray-400 bg-white px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500 dark:border-gray-500 dark:bg-gray-900 dark:text-white"
              >
                <option value="">All States</option>
                {AUSTRALIAN_STATES.map((state) => (
                  <option key={state} value={state}>
                    {state}
                  </option>
                ))}
              </select>
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
                                        disabled={!isAdmin}
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
                                        BOTJ
                                      </label>
                                      <select
                                        value={editData.botj}
                                        onChange={(e) => updateInlineEditField(campaign.id, 'botj', e.target.value)}
                                        className="w-full rounded-md border-2 border-gray-400 bg-white px-2 py-1 text-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500 dark:border-gray-500 dark:bg-gray-900 dark:text-white"
                                      >
                                        <option value="No">No</option>
                                        <option value="Yes">Yes</option>
                                      </select>
                                    </div>
                                  </div>
                                  
                                  {/* Only show checkboxes for future campaigns unless user is AD */}
                                  {(() => {
                                    const today = new Date();
                                    today.setHours(0, 0, 0, 0);
                                    const campaignDate = new Date(campaign.date);
                                    campaignDate.setHours(0, 0, 0, 0);
                                    const isFuture = campaignDate > today;
                                    const shouldShowCheckboxes = adminStatus === 'AD' || isFuture;
                                    
                                    return shouldShowCheckboxes ? (
                                      <div className="flex gap-6 justify-center pt-2">
                                        {/* TL OK checkbox: shown for all users */}
                                        <div className="flex items-center">
                                          <input
                                            id={`tl_ok_${campaign.id}`}
                                            type="checkbox"
                                            checked={editData.tl_ok}
                                            onChange={(e) => updateInlineEditField(campaign.id, 'tl_ok', e.target.checked)}
                                            className="h-5 w-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                          />
                                          <label htmlFor={`tl_ok_${campaign.id}`} className="ml-2 text-sm font-semibold text-gray-700 dark:text-gray-300">
                                            This Campaign is Correct
                                          </label>
                                        </div>
                                      </div>
                                    ) : null;
                                  })()}

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
                            const timeStr = campaign.time.includes('T')
                              ? campaign.time.split('T')[1]?.split('.')[0]
                              : campaign.time;
                            const [hours, minutes] = timeStr.split(':');
                            const hour = parseInt(hours, 10);
                            const ampm = hour >= 12 ? 'PM' : 'AM';
                            const displayHour = hour % 12 || 12;
                            const displayTime = `${displayHour}:${minutes} ${ampm}`;
                            
                            // BOTJ: only show "BOTJ" when value is Yes; show nothing when No
                            let showBOTJ = false;
                            if (campaign.botj === 'Yes') {
                              showBOTJ = true;
                            } else if (campaign.botj !== 'No' && campaign.botj !== null && campaign.botj !== '') {
                              const botjStr = String(campaign.botj).trim();
                              showBOTJ = botjStr === '1' || botjStr.toLowerCase() === 'yes' || parseInt(botjStr, 10) > 0;
                            }
                            
                            // Get state color for campaign line
                            const stateColor = getStateColor(campaign.state);
                            
                            result.push(
                              <div key={campaign.id} className={`p-4 sm:p-5 ${stateColor.bg} border-b-2 border-gray-800 dark:border-gray-600`}>
                                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                                  <div className="flex-1 min-w-0">
                                    {/* Top line: Place State • Time, with BOTJ right-justified at end */}
                                    <div className={`flex items-center justify-between gap-2 text-lg sm:text-xl font-bold ${stateColor.text} mb-2 break-words`}>
                                      <span>
                                        {place} {campaign.state} • {displayTime}
                                      </span>
                                      {showBOTJ && (
                                        <span className="shrink-0 ml-2">BOTJ</span>
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
                                    </div>
                                    {/* Only show checkboxes for future campaigns unless user is AD */}
                                    {(() => {
                                      const today = new Date();
                                      today.setHours(0, 0, 0, 0);
                                      const campaignDate = new Date(campaign.date);
                                      campaignDate.setHours(0, 0, 0, 0);
                                      const isFuture = campaignDate > today;
                                      const shouldShowCheckboxes = adminStatus === 'AD' || isFuture;
                                      
                                      return shouldShowCheckboxes ? (
                                        <div className="flex gap-6 justify-center text-sm sm:text-base mt-2 mb-2">
                                          {/* TL OK checkbox: shown for all users */}
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
                                      ) : null;
                                    })()}
                                  </div>
                                  <div className="flex flex-row gap-2 sm:ml-4 w-full sm:w-auto">
                                    {/* Show Record Results button if campaign date is today or earlier AND (user is admin OR campaign leader/mobile matches user) */}
                                    {(() => {
                                      const today = new Date();
                                      today.setHours(0, 0, 0, 0);
                                      const campaignDate = new Date(campaign.date);
                                      campaignDate.setHours(0, 0, 0, 0);
                                      const isPastOrToday = campaignDate <= today;
                                      
                                      // Admin users can see Record Results button for all past campaigns
                                      if (adminStatus === 'AD') {
                                        return isPastOrToday;
                                      }
                                      
                                      // For non-admin users, check if leader and mobile match
                                      if (!userMobileAndLeader || !userMobileAndLeader.leader || !userMobileAndLeader.mobile) {
                                        return false;
                                      }
                                      
                                      // Normalize and compare leader names
                                      const campaignLeaderNormalized = normalizeName(campaign.leader || '');
                                      const userLeaderNormalized = normalizeName(userMobileAndLeader.leader);
                                      const leaderMatches = campaignLeaderNormalized === userLeaderNormalized;
                                      
                                      // Normalize and compare mobile numbers
                                      const campaignMobileNormalized = normalizeMobile(campaign.mobile || '');
                                      const userMobileNormalized = normalizeMobile(userMobileAndLeader.mobile || '');
                                      const mobileMatches = campaignMobileNormalized === userMobileNormalized && campaignMobileNormalized !== '';
                                      
                                      return isPastOrToday && leaderMatches && mobileMatches;
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
