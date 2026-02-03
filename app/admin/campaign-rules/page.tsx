'use client';

import { useEffect, useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import MobileLayout from '@/components/MobileLayout';
import { getCurrentUser } from '@/lib/auth';
import { hasPermission, Permission } from '@/lib/permissions';
import { supabase } from '@/lib/supabaseClient';
import { getStateColor } from '@/lib/stateColors';
import { CampaignRule, previewRuleEvaluation } from '@/lib/campaignRules';
import { formatDateReadable, formatDateForDb } from '@/lib/campaignDates';
import { useCampaignDates } from '@/contexts/CampaignDatesContext';

const AUSTRALIAN_STATES = ['ACT', 'NSW', 'QLD', 'SA', 'TAS', 'VIC', 'WA', 'NT'];
const DAYS_OF_WEEK = [
  { value: 0, label: 'Sunday' },
  { value: 1, label: 'Monday' },
  { value: 2, label: 'Tuesday' },
  { value: 3, label: 'Wednesday' },
  { value: 4, label: 'Thursday' },
  { value: 5, label: 'Friday' },
  { value: 6, label: 'Saturday' },
];

const MONTH_WEEKS = [
  { value: 1, label: '1st Week' },
  { value: 2, label: '2nd Week' },
  { value: 3, label: '3rd Week' },
  { value: 4, label: '4th Week' },
  { value: -1, label: 'Last Week' },
];

function CampaignRulesPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { dates } = useCampaignDates();
  const [isLoading, setIsLoading] = useState(true);
  const [hasAccess, setHasAccess] = useState(false);
  const [user, setUser] = useState<any>(null);
  const [adminStatus, setAdminStatus] = useState<string | null>(null);
  const [userState, setUserState] = useState<string | null>(null);
  const [isStateLocked, setIsStateLocked] = useState(false);
  const [rules, setRules] = useState<CampaignRule[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  
  // Form state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formState, setFormState] = useState({
    name: '',
    leader: '',
    state: '',
    place: '',
    time: '',
    mobile: '',
    frequency_type: 'weekly' as 'weekly' | 'biweekly' | 'monthly' | 'custom',
    frequency_value: 2,
    month_week_number: null as number | null,
    month_day_of_week: null as number | null,
    day_of_week: 0,
    reference_date: '', // For biweekly rules
    start_date: '',
    end_date: '',
    is_active: true,
    priority: 0,
    notes: '',
  });
  
  const [filterActive, setFilterActive] = useState<string>('all'); // 'all', 'active', 'inactive'
  const [filterFrequency, setFilterFrequency] = useState<string>('');
  const [previewRuleId, setPreviewRuleId] = useState<string | null>(null);
  const [previewDates, setPreviewDates] = useState<Date[]>([]);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  
  // Dropdown data
  const [places, setPlaces] = useState<string[]>([]);
  const [leaders, setLeaders] = useState<string[]>([]);
  const [timeOptions, setTimeOptions] = useState<{ value: string; label: string }[]>([]);
  const [loadingPlaces, setLoadingPlaces] = useState(false);
  const [loadingLeaders, setLoadingLeaders] = useState(false);

  useEffect(() => {
    async function checkAuthAndPermissions() {
      try {
        const currentUser = await getCurrentUser();
        if (!currentUser) {
          router.push('/login');
          return;
        }
        setUser(currentUser);

        // Check if user is admin (AD), state reporter (SR), or team leader (TL)
        const { getUserAdminStatusAndMobile } = await import('@/lib/campaignFilter');
        const { admin: adminStatusValue, state: userStateValue } = await getUserAdminStatusAndMobile();
        setAdminStatus(adminStatusValue);
        setUserState(userStateValue);

        // Allow access for AD (admin), SR (state reporter), or TL (team leader - has state)
        const canAccess = adminStatusValue === 'AD' || adminStatusValue === 'SR' || (userStateValue != null && userStateValue.trim() !== '');
        if (!canAccess) {
          setError('You do not have permission to access this page');
          return;
        }

        // Check for state query parameter
        const stateParam = searchParams.get('state');
        if (adminStatusValue === 'SR') {
          // For SR users, use state from query param or their own state
          const stateToUse = stateParam || userStateValue;
          if (stateToUse) {
            setFormState(prev => ({ ...prev, state: stateToUse.toUpperCase().trim() }));
            setIsStateLocked(true);
          }
        } else if (adminStatusValue !== 'AD' && userStateValue) {
          // For TL (team leaders), lock state to their state
          const stateToUse = stateParam || userStateValue;
          if (stateToUse) {
            setFormState(prev => ({ ...prev, state: stateToUse.toUpperCase().trim() }));
            setIsStateLocked(true);
          }
        } else if (stateParam && adminStatusValue === 'AD') {
          // For AD users, pre-populate but don't lock
          setFormState(prev => ({ ...prev, state: stateParam.toUpperCase().trim() }));
        }

        setHasAccess(true);
        await fetchRules();
      } catch (err: any) {
        setError(err.message || 'Access denied');
      } finally {
        setIsLoading(false);
      }
    }
    checkAuthAndPermissions();
  }, [router, searchParams]);

  const fetchRules = async () => {
    try {
      let query = supabase
        .from('campaign_rules')
        .select('*');

      // Filter by state for SR and TL users
      if ((adminStatus === 'SR' || (adminStatus !== 'AD' && adminStatus !== 'SR')) && userState) {
        query = query.eq('state', userState.toUpperCase().trim());
      }

      const { data, error } = await query
        .order('priority', { ascending: false })
        .order('created_at', { ascending: false });
      
      if (error) throw error;
      setRules(data || []);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch campaign rules');
    }
  };

  useEffect(() => {
    if (hasAccess) {
      fetchRules();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasAccess, adminStatus, userState]);

  // Generate time options (8:00 AM to 8:00 PM, half-hour intervals)
  useEffect(() => {
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
  }, []);

  // Fetch places from state_places table when state changes
  useEffect(() => {
    async function fetchPlaces() {
      if (!formState.state) {
        setPlaces([]);
        setFormState(prev => ({ ...prev, place: '' }));
        return;
      }

      setLoadingPlaces(true);
      try {
        const { data, error } = await supabase
          .from('state_places')
          .select('place')
          .eq('state', formState.state)
          .order('place', { ascending: true });

        if (error) throw error;

        const uniquePlaces = Array.from(
          new Set((data || []).map((item) => item.place).filter(Boolean))
        ).sort();

        setPlaces(uniquePlaces);
        
        // If current place is not in the filtered list, clear it
        if (formState.place && !uniquePlaces.includes(formState.place)) {
          setFormState(prev => ({ ...prev, place: '' }));
        }
      } catch (err) {
        console.error('Error fetching places:', err);
        setPlaces([]);
      } finally {
        setLoadingPlaces(false);
      }
    }

    fetchPlaces();
  }, [formState.state]);

  // Fetch leaders from state_leaders table when state changes
  useEffect(() => {
    async function fetchLeaders() {
      if (!formState.state) {
        setLeaders([]);
        setFormState(prev => ({ ...prev, leader: '', mobile: '' }));
        return;
      }

      setLoadingLeaders(true);
      try {
        const { data, error } = await supabase
          .from('state_leaders')
          .select('leader')
          .eq('state', formState.state)
          .order('leader', { ascending: true });

        if (error) throw error;

        const uniqueLeaders = Array.from(
          new Set((data || []).map((item) => item.leader).filter(Boolean))
        ).sort();

        setLeaders(uniqueLeaders);
        
        // If current leader is not in the filtered list, clear it
        if (formState.leader && !uniqueLeaders.includes(formState.leader)) {
          setFormState(prev => ({ ...prev, leader: '', mobile: '' }));
        }
      } catch (err) {
        console.error('Error fetching leaders:', err);
        setLeaders([]);
      } finally {
        setLoadingLeaders(false);
      }
    }

    fetchLeaders();
  }, [formState.state]);

  // Fetch mobile from state_leaders when leader/state changes
  useEffect(() => {
    const fetchMobile = async () => {
      if (formState.leader && formState.state) {
        try {
          const { data, error } = await supabase
            .from('state_leaders')
            .select('mobile')
            .eq('state', formState.state)
            .eq('leader', formState.leader)
            .single();
          
          if (!error && data?.mobile) {
            setFormState(prev => ({ ...prev, mobile: data.mobile || '' }));
          } else {
            setFormState(prev => ({ ...prev, mobile: '' }));
          }
        } catch (err) {
          // Ignore errors - mobile is optional
          setFormState(prev => ({ ...prev, mobile: '' }));
        }
      } else {
        setFormState(prev => ({ ...prev, mobile: '' }));
      }
    };
    fetchMobile();
  }, [formState.leader, formState.state]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setIsSubmitting(true);

    try {
      // Validate state for SR and TL users - they can only manage rules for their state
      if ((adminStatus === 'SR' || (adminStatus !== 'AD' && adminStatus !== 'SR')) && userState) {
        const formStateNormalized = formState.state.trim().toUpperCase();
        const userStateNormalized = userState.trim().toUpperCase();
        if (formStateNormalized !== userStateNormalized) {
          throw new Error(`You can only manage campaign rules for ${userState}.`);
        }
      }

      // Validate required fields based on frequency type
      if (formState.frequency_type === 'monthly' && formState.month_week_number === null) {
        throw new Error('Week of month is required for monthly rules');
      }
      if ((formState.frequency_type === 'weekly' || formState.frequency_type === 'biweekly') && formState.day_of_week === null) {
        throw new Error('Day of week is required for weekly/biweekly rules');
      }
      if (formState.frequency_type === 'biweekly' && !formState.frequency_value) {
        throw new Error('Frequency value is required for biweekly rules');
      }

      const mobileValue = formState.mobile.trim() || null;
      const ruleData: any = {
        name: formState.name.trim(),
        leader: formState.leader.trim(),
        state: formState.state.trim(),
        place: formState.place.trim(),
        time: formState.time.trim(),
        mobile: mobileValue,
        frequency_type: formState.frequency_type,
        frequency_value: formState.frequency_type === 'biweekly' ? formState.frequency_value : null,
        month_week_number: formState.frequency_type === 'monthly' ? formState.month_week_number : null,
        month_day_of_week: formState.frequency_type === 'monthly' ? formState.month_day_of_week : null,
        day_of_week: (formState.frequency_type === 'weekly' || formState.frequency_type === 'biweekly') ? formState.day_of_week : null,
        start_date: formState.start_date || null,
        end_date: formState.end_date || null,
        is_active: formState.is_active,
        priority: formState.priority,
        notes: formState.notes.trim() || null,
        rule_config: {
          ...(formState.frequency_type === 'biweekly' && formState.reference_date
            ? { reference_date: formState.reference_date }
            : {}),
        },
      };

      if (editingId) {
        // Update existing rule
        const { error } = await supabase
          .from('campaign_rules')
          .update(ruleData)
          .eq('id', editingId);

        if (error) throw error;
        setSuccess('Campaign rule updated successfully');
      } else {
        // Create new rule
        const { error } = await supabase
          .from('campaign_rules')
          .insert([{ ...ruleData, created_by: user?.id }]);

        if (error) throw error;
        setSuccess('Campaign rule created successfully');
      }

      // Reset form
      resetForm();
      await fetchRules();
    } catch (err: any) {
      setError(err.message || 'Failed to save campaign rule');
    } finally {
      setIsSubmitting(false);
    }
  };

  const resetForm = () => {
    setEditingId(null);
    // Preserve locked state for SR and TL users
    const preservedState = isStateLocked && userState ? userState.toUpperCase().trim() : '';
    setFormState({
      name: '',
      leader: '',
      state: preservedState,
      place: '',
      time: '',
      mobile: '',
      frequency_type: 'weekly',
      frequency_value: 2,
      month_week_number: null,
      month_day_of_week: null,
      day_of_week: 0,
      reference_date: '',
      start_date: '',
      end_date: '',
      is_active: true,
      priority: 0,
      notes: '',
    });
    setPreviewRuleId(null);
    setPreviewDates([]);
  };

  const handleEdit = async (rule: CampaignRule) => {
    setEditingId(rule.id);
    // For SR/TL users with locked state, use the locked state instead of rule's state
    const stateToUse = isStateLocked && userState ? userState.toUpperCase().trim() : rule.state;
    setFormState({
      name: rule.name,
      leader: rule.leader,
      state: stateToUse,
      place: rule.place,
      time: rule.time,
      mobile: rule.mobile || '',
      frequency_type: rule.frequency_type,
      frequency_value: rule.frequency_value || 2,
      month_week_number: rule.month_week_number,
      month_day_of_week: rule.month_day_of_week,
      day_of_week: rule.day_of_week ?? 0,
      reference_date: rule.rule_config?.reference_date || '',
      start_date: rule.start_date || '',
      end_date: rule.end_date || '',
      is_active: rule.is_active,
      priority: rule.priority,
      notes: rule.notes || '',
    });
    
    // Load places and leaders for the state (use locked state for SR/TL users)
    if (stateToUse) {
      setLoadingPlaces(true);
      setLoadingLeaders(true);
      try {
        const [placesResult, leadersResult] = await Promise.all([
          supabase
            .from('state_places')
            .select('place')
            .eq('state', stateToUse)
            .order('place', { ascending: true }),
          supabase
            .from('state_leaders')
            .select('leader')
            .eq('state', stateToUse)
            .order('leader', { ascending: true }),
        ]);

        if (placesResult.data) {
          const uniquePlaces = Array.from(
            new Set(placesResult.data.map((item) => item.place).filter(Boolean))
          ).sort();
          setPlaces(uniquePlaces);
        }

        if (leadersResult.data) {
          const uniqueLeaders = Array.from(
            new Set(leadersResult.data.map((item) => item.leader).filter(Boolean))
          ).sort();
          setLeaders(uniqueLeaders);
        }
      } catch (err) {
        console.error('Error loading places/leaders for edit:', err);
      } finally {
        setLoadingPlaces(false);
        setLoadingLeaders(false);
      }
    }
    
    setError(null);
    setSuccess(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this campaign rule?')) {
      return;
    }

    try {
      const { error } = await supabase.from('campaign_rules').delete().eq('id', id);
      if (error) throw error;
      setSuccess('Campaign rule deleted successfully');
      await fetchRules();
    } catch (err: any) {
      setError(err.message || 'Failed to delete campaign rule');
    }
  };

  const handlePreview = async (rule: CampaignRule) => {
    if (!dates) {
      setError('Campaign dates not available');
      return;
    }

    setIsLoadingPreview(true);
    setPreviewRuleId(rule.id);
    setError(null);

    try {
      const previewStart = new Date(dates.secondWeekStart);
      const previewEnd = new Date(previewStart);
      previewEnd.setDate(previewEnd.getDate() + 13); // Preview 2 weeks

      const { dates: previewDatesResult } = previewRuleEvaluation(rule, previewStart, previewEnd);
      setPreviewDates(previewDatesResult);
    } catch (err: any) {
      setError(err.message || 'Failed to preview rule');
    } finally {
      setIsLoadingPreview(false);
    }
  };

  const handleToggleActive = async (rule: CampaignRule) => {
    try {
      const { error } = await supabase
        .from('campaign_rules')
        .update({ is_active: !rule.is_active })
        .eq('id', rule.id);
      
      if (error) throw error;
      await fetchRules();
    } catch (err: any) {
      setError(err.message || 'Failed to update rule status');
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

  if (!hasAccess) {
    return (
      <MobileLayout>
        <div className="p-4">
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-800 dark:bg-red-900/20">
            <h2 className="text-lg font-semibold text-red-800 dark:text-red-200">
              Access Denied
            </h2>
            <p className="mt-1 text-sm text-red-600 dark:text-red-300">
              {error || 'You do not have permission to access this page.'}
            </p>
            <button
              onClick={() => router.push(adminStatus === 'SR' || (adminStatus !== 'AD' && adminStatus !== 'SR') ? '/app' : '/admin')}
              className="mt-4 rounded-md bg-red-600 px-4 py-2 text-base font-bold text-white hover:bg-red-700 border-2 border-gray-800 dark:border-gray-600"
            >
              Go Back
            </button>
          </div>
        </div>
      </MobileLayout>
    );
  }

  const filteredRules = rules.filter(rule => {
    if (filterActive === 'active' && !rule.is_active) return false;
    if (filterActive === 'inactive' && rule.is_active) return false;
    if (filterFrequency && rule.frequency_type !== filterFrequency) return false;
    return true;
  });

  return (
    <MobileLayout>
      <div className="p-4">
        <div className="mb-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                Campaign Rules
              </h1>
              <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                Manage rules for automatic campaign generation
              </p>
            </div>
            <button
              onClick={() => router.push(adminStatus === 'SR' || (adminStatus !== 'AD' && adminStatus !== 'SR') ? '/app' : '/admin')}
              className="rounded-md bg-gray-200 px-3 py-2 text-base font-bold text-gray-700 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600 border-2 border-gray-800 dark:border-gray-600"
            >
              {adminStatus === 'SR' || (adminStatus !== 'AD' && adminStatus !== 'SR') ? 'Back to Home' : 'Back to Admin Panel'}
            </button>
          </div>
        </div>

        {/* Success/Error Messages */}
        {success && (
          <div className="mb-4 rounded-md bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-800 dark:bg-green-900/20 dark:border-green-800 dark:text-green-200">
            {success}
          </div>
        )}
        {error && (
          <div className="mb-4 rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-800 dark:bg-red-900/20 dark:border-red-800 dark:text-red-200">
            {error}
          </div>
        )}

        {/* Add/Edit Form */}
        <div className="mb-6 rounded-lg border border-gray-200 bg-blue-50 p-4 shadow-sm dark:border-gray-700 dark:bg-blue-900/20">
          <h2 className="mb-4 text-lg font-semibold text-gray-900 dark:text-gray-100">
            {editingId ? 'Edit Campaign Rule' : 'Add New Campaign Rule'}
          </h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="name" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                Rule Name *
              </label>
              <input
                id="name"
                type="text"
                required
                value={formState.name}
                onChange={(e) => setFormState({ ...formState, name: e.target.value })}
                className="mt-1 block w-full rounded-md border-2 border-gray-400 bg-white px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500 dark:border-gray-500 dark:bg-gray-900 dark:text-white"
                placeholder="e.g., Rob - Clayton Monthly"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="state" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                  State *
                </label>
                <select
                  id="state"
                  required
                  value={formState.state}
                  onChange={(e) => setFormState({ ...formState, state: e.target.value })}
                  disabled={isStateLocked}
                  className="mt-1 block w-full rounded-md border-2 border-gray-400 bg-white px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500 disabled:bg-gray-100 disabled:cursor-not-allowed dark:border-gray-500 dark:bg-gray-900 dark:text-white dark:disabled:bg-gray-700"
                >
                  <option value="">Select state</option>
                  {AUSTRALIAN_STATES.map((state) => (
                    <option key={state} value={state}>
                      {state}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="place" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                  Place *
                </label>
                <select
                  id="place"
                  required
                  value={formState.place}
                  onChange={(e) => setFormState({ ...formState, place: e.target.value })}
                  disabled={!formState.state || loadingPlaces}
                  className="mt-1 block w-full rounded-md border-2 border-gray-400 bg-white px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500 disabled:bg-gray-100 disabled:cursor-not-allowed dark:border-gray-500 dark:bg-gray-900 dark:text-white dark:disabled:bg-gray-700"
                >
                  <option value="">
                    {!formState.state
                      ? 'Select a state first'
                      : loadingPlaces
                      ? 'Loading places...'
                      : places.length === 0
                      ? 'No places found for this state'
                      : 'Select a place'}
                  </option>
                  {places.map((place) => (
                    <option key={place} value={place}>
                      {place}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="leader" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                  Leader *
                </label>
                <select
                  id="leader"
                  required
                  value={formState.leader}
                  onChange={(e) => setFormState({ ...formState, leader: e.target.value })}
                  disabled={!formState.state || loadingLeaders}
                  className="mt-1 block w-full rounded-md border-2 border-gray-400 bg-white px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500 disabled:bg-gray-100 disabled:cursor-not-allowed dark:border-gray-500 dark:bg-gray-900 dark:text-white dark:disabled:bg-gray-700"
                >
                  <option value="">
                    {!formState.state
                      ? 'Select a state first'
                      : loadingLeaders
                      ? 'Loading leaders...'
                      : leaders.length === 0
                      ? 'No leaders found for this state'
                      : 'Select a leader'}
                  </option>
                  {leaders.map((leader) => (
                    <option key={leader} value={leader}>
                      {leader}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="time" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                  Time *
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
            </div>

            <div>
              <label htmlFor="mobile" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                Mobile (Optional - auto-filled from state_leaders)
              </label>
              <input
                id="mobile"
                type="tel"
                value={formState.mobile}
                onChange={(e) => setFormState({ ...formState, mobile: e.target.value })}
                className="mt-1 block w-full rounded-md border-2 border-gray-400 bg-white px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500 dark:border-gray-500 dark:bg-gray-900 dark:text-white"
                placeholder="Auto-filled or enter manually"
              />
            </div>

            <div>
              <label htmlFor="frequency_type" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                Frequency Type *
              </label>
              <select
                id="frequency_type"
                required
                value={formState.frequency_type}
                onChange={(e) => setFormState({ ...formState, frequency_type: e.target.value as any })}
                className="mt-1 block w-full rounded-md border-2 border-gray-400 bg-white px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500 dark:border-gray-500 dark:bg-gray-900 dark:text-white"
              >
                <option value="weekly">Weekly</option>
                <option value="biweekly">Biweekly (Every N weeks)</option>
                <option value="monthly">Monthly</option>
                <option value="custom">Custom (Advanced)</option>
              </select>
            </div>

            {/* Weekly/Biweekly fields */}
            {(formState.frequency_type === 'weekly' || formState.frequency_type === 'biweekly') && (
              <>
                {formState.frequency_type === 'biweekly' && (
                  <>
                    <div>
                      <label htmlFor="frequency_value" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                        Every N Weeks *
                      </label>
                      <input
                        id="frequency_value"
                        type="number"
                        min="2"
                        required
                        value={formState.frequency_value}
                        onChange={(e) => setFormState({ ...formState, frequency_value: parseInt(e.target.value) || 2 })}
                        className="mt-1 block w-full rounded-md border-2 border-gray-400 bg-white px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500 dark:border-gray-500 dark:bg-gray-900 dark:text-white"
                      />
                    </div>
                    <div>
                      <label htmlFor="reference_date" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                        Reference Date (Optional)
                      </label>
                      <input
                        id="reference_date"
                        type="date"
                        value={formState.reference_date}
                        onChange={(e) => setFormState({ ...formState, reference_date: e.target.value })}
                        className="mt-1 block w-full rounded-md border-2 border-gray-400 bg-white px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500 dark:border-gray-500 dark:bg-gray-900 dark:text-white"
                      />
                      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                        The starting date for the biweekly pattern. If not set, uses the target period start date.
                      </p>
                    </div>
                  </>
                )}
                <div>
                  <label htmlFor="day_of_week" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                    Day of Week *
                  </label>
                  <select
                    id="day_of_week"
                    required
                    value={formState.day_of_week}
                    onChange={(e) => setFormState({ ...formState, day_of_week: parseInt(e.target.value) })}
                    className="mt-1 block w-full rounded-md border-2 border-gray-400 bg-white px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500 dark:border-gray-500 dark:bg-gray-900 dark:text-white"
                  >
                    {DAYS_OF_WEEK.map((day) => (
                      <option key={day.value} value={day.value}>
                        {day.label}
                      </option>
                    ))}
                  </select>
                </div>
              </>
            )}

            {/* Monthly fields */}
            {formState.frequency_type === 'monthly' && (
              <>
                <div>
                  <label htmlFor="month_week_number" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                    Week of Month *
                  </label>
                  <select
                    id="month_week_number"
                    required
                    value={formState.month_week_number || ''}
                    onChange={(e) => setFormState({ ...formState, month_week_number: parseInt(e.target.value) || null })}
                    className="mt-1 block w-full rounded-md border-2 border-gray-400 bg-white px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500 dark:border-gray-500 dark:bg-gray-900 dark:text-white"
                  >
                    <option value="">Select week</option>
                    {MONTH_WEEKS.map((week) => (
                      <option key={week.value} value={week.value}>
                        {week.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="month_day_of_week" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                    Day of Week (Optional - leave blank for first day of week)
                  </label>
                  <select
                    id="month_day_of_week"
                    value={formState.month_day_of_week || ''}
                    onChange={(e) => setFormState({ ...formState, month_day_of_week: e.target.value ? parseInt(e.target.value) : null })}
                    className="mt-1 block w-full rounded-md border-2 border-gray-400 bg-white px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500 dark:border-gray-500 dark:bg-gray-900 dark:text-white"
                  >
                    <option value="">Any day in week</option>
                    {DAYS_OF_WEEK.map((day) => (
                      <option key={day.value} value={day.value}>
                        {day.label}
                      </option>
                    ))}
                  </select>
                </div>
              </>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="start_date" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                  Start Date (Optional)
                </label>
                <input
                  id="start_date"
                  type="date"
                  value={formState.start_date}
                  onChange={(e) => setFormState({ ...formState, start_date: e.target.value })}
                  className="mt-1 block w-full rounded-md border-2 border-gray-400 bg-white px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500 dark:border-gray-500 dark:bg-gray-900 dark:text-white"
                />
              </div>
              <div>
                <label htmlFor="end_date" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                  End Date (Optional)
                </label>
                <input
                  id="end_date"
                  type="date"
                  value={formState.end_date}
                  onChange={(e) => setFormState({ ...formState, end_date: e.target.value })}
                  className="mt-1 block w-full rounded-md border-2 border-gray-400 bg-white px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500 dark:border-gray-500 dark:bg-gray-900 dark:text-white"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="priority" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                  Priority (Higher = Override)
                </label>
                <input
                  id="priority"
                  type="number"
                  value={formState.priority}
                  onChange={(e) => setFormState({ ...formState, priority: parseInt(e.target.value) || 0 })}
                  className="mt-1 block w-full rounded-md border-2 border-gray-400 bg-white px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500 dark:border-gray-500 dark:bg-gray-900 dark:text-white"
                />
              </div>
              <div className="flex items-center pt-8">
                <label className="flex items-center">
                  <input
                    type="checkbox"
                    checked={formState.is_active}
                    onChange={(e) => setFormState({ ...formState, is_active: e.target.checked })}
                    className="mr-2 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Active</span>
                </label>
              </div>
            </div>

            <div>
              <label htmlFor="notes" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                Notes (Optional)
              </label>
              <textarea
                id="notes"
                value={formState.notes}
                onChange={(e) => setFormState({ ...formState, notes: e.target.value })}
                rows={3}
                className="mt-1 block w-full rounded-md border-2 border-gray-400 bg-white px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500 dark:border-gray-500 dark:bg-gray-900 dark:text-white"
                placeholder="Additional notes about this rule"
              />
            </div>

            <div className="flex gap-2">
              <button
                type="submit"
                disabled={isSubmitting}
                className="flex-1 rounded-md bg-blue-600 px-4 py-2 text-base font-bold text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed border-2 border-gray-800 dark:border-gray-600"
              >
                {isSubmitting ? 'Saving...' : editingId ? 'Update' : 'Create'}
              </button>
              {editingId && (
                <button
                  type="button"
                  onClick={resetForm}
                  className="rounded-md bg-gray-200 px-4 py-2 text-base font-bold text-gray-700 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600 border-2 border-gray-800 dark:border-gray-600"
                >
                  Cancel
                </button>
              )}
            </div>
          </form>
        </div>

        {/* Filters */}
        <div className="mb-4 grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="filter_active" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
              Filter by Status
            </label>
            <select
              id="filter_active"
              value={filterActive}
              onChange={(e) => setFilterActive(e.target.value)}
              className="mt-1 block w-full rounded-md border-2 border-gray-400 bg-white px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500 dark:border-gray-500 dark:bg-gray-900 dark:text-white"
            >
              <option value="all">All</option>
              <option value="active">Active Only</option>
              <option value="inactive">Inactive Only</option>
            </select>
          </div>
          <div>
            <label htmlFor="filter_frequency" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
              Filter by Frequency
            </label>
            <select
              id="filter_frequency"
              value={filterFrequency}
              onChange={(e) => setFilterFrequency(e.target.value)}
              className="mt-1 block w-full rounded-md border-2 border-gray-400 bg-white px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500 dark:border-gray-500 dark:bg-gray-900 dark:text-white"
            >
              <option value="">All Types</option>
              <option value="weekly">Weekly</option>
              <option value="biweekly">Biweekly</option>
              <option value="monthly">Monthly</option>
              <option value="custom">Custom</option>
            </select>
          </div>
        </div>

        {/* List of Rules */}
        <div className="rounded-lg border-2 border-gray-800 dark:border-gray-600 bg-white shadow-sm dark:bg-gray-800">
          <div className="p-4">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              Campaign Rules ({filteredRules.length})
            </h2>
          </div>
          <div className="divide-y divide-gray-200 dark:divide-gray-700">
            {filteredRules.length === 0 ? (
              <div className="p-4 text-center text-sm text-gray-500 dark:text-gray-400">
                No campaign rules found
              </div>
            ) : (
              filteredRules.map((rule) => {
                const stateColor = getStateColor(rule.state);
                const frequencyLabel = rule.frequency_type === 'monthly' 
                  ? `${MONTH_WEEKS.find(w => w.value === rule.month_week_number)?.label || 'Unknown'} of month`
                  : rule.frequency_type === 'biweekly'
                  ? `Every ${rule.frequency_value} weeks`
                  : rule.frequency_type === 'weekly'
                  ? 'Every week'
                  : 'Custom';
                
                const dayLabel = rule.day_of_week !== null 
                  ? DAYS_OF_WEEK.find(d => d.value === rule.day_of_week)?.label
                  : rule.month_day_of_week !== null
                  ? DAYS_OF_WEEK.find(d => d.value === rule.month_day_of_week)?.label
                  : null;

                return (
                  <div key={rule.id} className={`p-4 ${stateColor.bg}`}>
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <div className={`font-medium ${stateColor.text}`}>
                            {rule.name}
                          </div>
                          {!rule.is_active && (
                            <span className="rounded bg-gray-200 px-2 py-0.5 text-xs font-medium text-gray-600 dark:bg-gray-700 dark:text-gray-400">
                              Inactive
                            </span>
                          )}
                          {rule.priority > 0 && (
                            <span className="rounded bg-yellow-200 px-2 py-0.5 text-xs font-medium text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300">
                              Priority: {rule.priority}
                            </span>
                          )}
                        </div>
                        <div className={`text-sm ${stateColor.text} opacity-75 mt-1`}>
                          {rule.leader} - {rule.place}, {rule.state} at {rule.time}
                        </div>
                        <div className={`text-xs ${stateColor.text} opacity-60 mt-1`}>
                          {frequencyLabel}{dayLabel ? ` on ${dayLabel}` : ''}
                        </div>
                        {rule.notes && (
                          <div className={`text-xs ${stateColor.text} opacity-60 mt-1 italic`}>
                            {rule.notes}
                          </div>
                        )}
                        {previewRuleId === rule.id && (
                          <div className="mt-2 rounded bg-white/50 p-2 dark:bg-gray-900/50">
                            <div className="text-xs font-medium text-gray-700 dark:text-gray-300">
                              Preview (next 2 weeks):
                            </div>
                            {isLoadingPreview ? (
                              <div className="text-xs text-gray-500 dark:text-gray-400">Loading...</div>
                            ) : previewDates.length > 0 ? (
                              <div className="text-xs text-gray-600 dark:text-gray-400">
                                {previewDates.map((d, i) => (
                                  <span key={i} className="mr-2">
                                    {formatDateReadable(d)}
                                  </span>
                                ))}
                              </div>
                            ) : (
                              <div className="text-xs text-gray-500 dark:text-gray-400">
                                No dates match in preview period
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                      <div className="flex flex-col gap-2 ml-4">
                        <button
                          onClick={() => handlePreview(rule)}
                          className="rounded-md bg-green-100 px-3 py-1 text-sm font-medium text-green-700 hover:bg-green-200 dark:bg-green-900/30 dark:text-green-300 dark:hover:bg-green-900/50"
                        >
                          {previewRuleId === rule.id ? 'Hide Preview' : 'Preview'}
                        </button>
                        <button
                          onClick={() => handleEdit(rule)}
                          className="rounded-md bg-blue-100 px-3 py-1 text-sm font-medium text-blue-700 hover:bg-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:hover:bg-blue-900/50"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleToggleActive(rule)}
                          className={`rounded-md px-3 py-1 text-sm font-medium ${
                            rule.is_active
                              ? 'bg-yellow-100 text-yellow-700 hover:bg-yellow-200 dark:bg-yellow-900/30 dark:text-yellow-300'
                              : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300'
                          }`}
                        >
                          {rule.is_active ? 'Deactivate' : 'Activate'}
                        </button>
                        <button
                          onClick={() => handleDelete(rule.id)}
                          className="rounded-md bg-red-100 px-3 py-1 text-base font-bold text-red-700 hover:bg-red-200 dark:bg-red-900/30 dark:text-red-300 dark:hover:bg-red-900/50 border-2 border-gray-800 dark:border-gray-600"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </MobileLayout>
  );
}

export default function CampaignRulesPage() {
  return (
    <Suspense fallback={
      <MobileLayout>
        <div className="p-4">
          <div className="text-center">Loading...</div>
        </div>
      </MobileLayout>
    }>
      <CampaignRulesPageContent />
    </Suspense>
  );
}
