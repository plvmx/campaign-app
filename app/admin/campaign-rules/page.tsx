'use client';

import { useCallback, useEffect, useMemo, useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import MobileLayout from '@/components/MobileLayout';
import LoadingSpinner from '@/components/LoadingSpinner';
import Modal from '@/components/Modal';
import { useUser } from '@/contexts/UserContext';
import { getStateColor } from '@/lib/stateColors';
import { getPlacesForState, getLeadersForState, getLeaderMobile, type PlaceOption } from '@/lib/services/dropdownService';
import { getRules, createRule, updateRule, deleteRule, setRuleActive } from '@/lib/services/rulesService';
import type { CampaignRule } from '@/lib/types';
import { evaluateRule, previewRuleEvaluation } from '@/lib/campaignRules';
import { formatDateReadable } from '@/lib/campaignDates';
import { AUSTRALIAN_STATES } from '@/lib/constants';
import { getErrorMessage } from '@/lib/errorUtils';
import { combinePlaceAndSite } from '@/lib/placeSite';
import { isRecognizedAdminStatus } from '@/lib/campaignFilter';
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

/** Time options for the campaign time picker (8 AM – 8 PM, 30-min intervals). */
const TIME_OPTIONS: { value: string; label: string }[] = (() => {
  const times: { value: string; label: string }[] = [];
  for (let hour = 8; hour <= 20; hour++) {
    for (let minute = 0; minute < 60; minute += 30) {
      const timeStr = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
      const displayHour = hour % 12 || 12;
      const ampm = hour >= 12 ? 'PM' : 'AM';
      times.push({ value: timeStr, label: `${displayHour}:${minute.toString().padStart(2, '0')} ${ampm}` });
    }
  }
  return times;
})();

/**
 * Convert form selections into a plain-English schedule description.
 * Shown in the create-confirmation modal so leaders can sanity-check their settings.
 */
function buildScheduleSummary(
  frequencyType: 'weekly' | 'biweekly' | 'monthly',
  dayOfWeek: number,
  monthWeekNumber: number | null,
  monthDayOfWeek: number | null,
  frequencyValue: number,
): string {
  const dayName      = DAYS_OF_WEEK.find(d => d.value === dayOfWeek)?.label      ?? 'Unknown day';
  const monthDayName = DAYS_OF_WEEK.find(d => d.value === monthDayOfWeek)?.label ?? 'Unknown day';

  switch (frequencyType) {
    case 'weekly':
      return `Every ${dayName}`;
    case 'biweekly':
      return `Every ${frequencyValue} weeks on ${dayName}`;
    case 'monthly': {
      if (monthWeekNumber === null || monthDayOfWeek === null) return 'Monthly (incomplete settings)';
      const ordinal =
        monthWeekNumber === -1 ? 'last'
        : monthWeekNumber === 1 ? '1st'
        : monthWeekNumber === 2 ? '2nd'
        : monthWeekNumber === 3 ? '3rd'
        : '4th';
      return `The ${ordinal} ${monthDayName} of each month`;
    }
  }
}

/** Normalize time string from DB (e.g. "10:00:00") to HH:MM for form/display. */
function timeToHHMM(timeStr: string | null | undefined): string {
  if (!timeStr) return '';
  const part = timeStr.trim().split(':');
  if (part.length >= 2) {
    const h = part[0].padStart(2, '0');
    const m = part[1].padStart(2, '0');
    return `${h}:${m}`;
  }
  return timeStr;
}

function CampaignRulesPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, adminStatus, userState, userLeader, isLoading: isUserLoading } = useUser();
  const [hasAccess, setHasAccess] = useState(false);
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
    site: '',
    time: '',
    mobile: '',
    frequency_type: 'weekly' as 'weekly' | 'biweekly' | 'monthly',
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
  
  const [isFormExpanded, setIsFormExpanded] = useState(false); // collapsed until we know rule count
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  // Create-confirmation modal
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [confirmDates, setConfirmDates] = useState<string[]>([]);
  const [pendingRuleData, setPendingRuleData] = useState<Omit<CampaignRule, 'id'> | null>(null);
  const [filterActive, setFilterActive] = useState<string>('all'); // 'all', 'active', 'inactive'
  const [filterFrequency, setFilterFrequency] = useState<string>('');
  const [previewRuleId, setPreviewRuleId] = useState<string | null>(null);
  const [previewDates, setPreviewDates] = useState<Date[]>([]);

  // Dropdown data
  const [places, setPlaces] = useState<PlaceOption[]>([]);
  const [leaders, setLeaders] = useState<string[]>([]);
  const [loadingPlaces, setLoadingPlaces] = useState(false);
  const [loadingLeaders, setLoadingLeaders] = useState(false);

  useEffect(() => {
    if (isUserLoading) return;
    if (!user) { router.push('/login'); return; }

    const canAccess = isRecognizedAdminStatus(adminStatus) || (userState != null && userState.trim() !== '');
    if (!canAccess) {
      setError('You do not have permission to access this page');
      return;
    }

    const stateParam = searchParams.get('state');
    if (adminStatus === 'SR') {
      const stateToUse = stateParam || userState;
      if (stateToUse) {
        setFormState(prev => ({ ...prev, state: stateToUse.toUpperCase().trim() }));
        setIsStateLocked(true);
      }
    } else if (adminStatus !== 'AD' && userState) {
      const stateToUse = stateParam || userState;
      if (stateToUse) {
        setFormState(prev => ({
          ...prev,
          state: stateToUse.toUpperCase().trim(),
          ...(userLeader ? { leader: userLeader } : {}),
        }));
        setIsStateLocked(true);
      }
    } else if (stateParam && adminStatus === 'AD') {
      setFormState(prev => ({ ...prev, state: stateParam.toUpperCase().trim() }));
    }

    setHasAccess(true);
  }, [isUserLoading, user, adminStatus, userState, userLeader, router, searchParams]);

  const fetchRules = useCallback(async () => {
    try {
      const fetched = await getRules({ adminStatus, userState, userLeader });
      setRules(fetched);
      // Auto-expand the form when the user has no rules yet so they can create their first one
      setIsFormExpanded(prev => prev || fetched.length === 0);
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Failed to fetch campaign rules'));
    }
  }, [adminStatus, userState, userLeader]);

  useEffect(() => {
    if (hasAccess) {
      fetchRules();
    }
  }, [hasAccess, fetchRules]);

  // Fetch places from state_places table when state changes
  useEffect(() => {
    if (!formState.state) {
      setPlaces([]);
      setFormState(prev => ({ ...prev, place: '', site: '' }));
      return;
    }
    setLoadingPlaces(true);
    getPlacesForState(formState.state)
      .then((uniquePlaces) => {
        setPlaces(uniquePlaces);
        setFormState(prev =>
          prev.place && !uniquePlaces.some((p) => p.label === combinePlaceAndSite(prev.place, prev.site))
            ? { ...prev, place: '', site: '' }
            : prev,
        );
      })
      .catch(() => setPlaces([]))
      .finally(() => setLoadingPlaces(false));
  }, [formState.state]);

  // Derived access-level flags — computed once and used throughout.
  const isNonAdmin   = adminStatus !== 'AD';                                       // SR or TL or regular
  const isTeamLeader = adminStatus !== 'AD' && adminStatus !== 'SR' && !!userState;
  const isLeaderLocked = isTeamLeader && !!userLeader;

  useEffect(() => {
    async function fetchLeaders() {
      if (!formState.state) {
        setLeaders([]);
        setFormState(prev => ({ ...prev, leader: '', mobile: '' }));
        return;
      }

      // Team Leaders: can only create rules for themselves — show only their name and lock leader
      if (isTeamLeader && userLeader && formState.state.toUpperCase().trim() === (userState || '').toUpperCase().trim()) {
        setLeaders([userLeader]);
        setFormState(prev => ({ ...prev, leader: prev.leader || userLeader }));
        setLoadingLeaders(false);
        return;
      }

      setLoadingLeaders(true);
      getLeadersForState(formState.state)
        .then((uniqueLeaders) => {
          setLeaders(uniqueLeaders);
          setFormState(prev =>
            prev.leader && !uniqueLeaders.includes(prev.leader)
              ? { ...prev, leader: '', mobile: '' }
              : prev,
          );
        })
        .catch(() => setLeaders([]))
        .finally(() => setLoadingLeaders(false));
    }

    fetchLeaders();
  }, [formState.state, isTeamLeader, userLeader, userState]);

  // Fetch mobile from state_leaders when leader/state changes
  useEffect(() => {
    if (!formState.leader || !formState.state) {
      setFormState(prev => ({ ...prev, mobile: '' }));
      return;
    }
    getLeaderMobile(formState.state, formState.leader).then((mobile) => {
      setFormState(prev => ({ ...prev, mobile: mobile || '' }));
    });
  }, [formState.leader, formState.state]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setIsSubmitting(true);

    try {
      // Validate state for SR and TL users — they can only manage rules for their state
      if (isNonAdmin && userState) {
        const formStateNormalized = formState.state.trim().toUpperCase();
        const userStateNormalized = userState.trim().toUpperCase();
        if (formStateNormalized !== userStateNormalized) {
          throw new Error(`You can only manage campaign rules for ${userState}.`);
        }
      }
      // Team Leaders: can only create/edit rules for themselves
      if (isTeamLeader && userLeader && formState.leader?.trim() !== userLeader.trim()) {
        throw new Error('As a Team Leader you can only create rules for yourself.');
      }

      // Validate required fields based on frequency type — collect all errors up front
      const newFieldErrors: Record<string, string> = {};
      if (formState.frequency_type === 'monthly') {
        if (formState.month_week_number === null) {
          newFieldErrors.month_week_number = 'Please select which week of the month.';
        }
        if (formState.month_day_of_week === null) {
          newFieldErrors.month_day_of_week = 'Please select which day of the week.';
        }
      }
      if ((formState.frequency_type === 'weekly' || formState.frequency_type === 'biweekly') && formState.day_of_week === null) {
        newFieldErrors.day_of_week = 'Please select the day of week.';
      }
      if (formState.frequency_type === 'biweekly' && !formState.frequency_value) {
        newFieldErrors.frequency_value = 'Please enter how many weeks between campaigns (minimum 2).';
      }
      if (Object.keys(newFieldErrors).length > 0) {
        setFieldErrors(newFieldErrors);
        setIsSubmitting(false);
        return;
      }
      setFieldErrors({});

      const mobileValue = formState.mobile.trim() || null;
      const ruleData: Omit<CampaignRule, 'id'> = {
        name: formState.name.trim(),
        leader: formState.leader.trim(),
        state: formState.state.trim(),
        place: formState.place.trim(),
        site: formState.site.trim(),
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
        // Update existing rule — proceed directly, no confirmation needed.
        await updateRule(editingId, ruleData);
        setSuccess('Campaign rule updated successfully');
        setIsFormExpanded(false);
        resetForm();
        await fetchRules();
      } else {
        // New rule — compute upcoming dates and show confirmation modal before writing.
        const searchStart = ruleData.start_date
          ? new Date(ruleData.start_date + 'T00:00:00')
          : (() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; })();
        const searchEnd = new Date(searchStart);
        searchEnd.setMonth(searchEnd.getMonth() + 6);

        const previewRule: CampaignRule = { id: '__preview__', ...ruleData };
        const upcomingCampaigns = evaluateRule(previewRule, searchStart, searchEnd);
        const upcomingDates = upcomingCampaigns.slice(0, 5).map(c => c.date);

        setPendingRuleData(ruleData);
        setConfirmDates(upcomingDates);
        setShowConfirmModal(true);
        setIsSubmitting(false);
        return; // Wait for user confirmation before inserting.
      }
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Failed to save campaign rule'));
    } finally {
      setIsSubmitting(false);
    }
  };

  /** Called when the leader confirms the creation modal — performs the actual DB insert. */
  const handleConfirmCreate = async () => {
    if (!pendingRuleData) return;
    setIsSubmitting(true);
    setShowConfirmModal(false);
    try {
      await createRule(pendingRuleData, user?.id ?? '');
      setSuccess('Campaign rule created successfully');
      setIsFormExpanded(false);
      resetForm();
      await fetchRules();
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Failed to create campaign rule'));
    } finally {
      setIsSubmitting(false);
      setPendingRuleData(null);
      setConfirmDates([]);
    }
  };

  /** Dismisses the confirmation modal without writing anything. */
  const handleCancelConfirm = () => {
    setShowConfirmModal(false);
    setPendingRuleData(null);
    setConfirmDates([]);
  };

  const resetForm = () => {
    setEditingId(null);
    // Preserve locked state for SR and TL users; preserve locked leader for TL
    const preservedState = isStateLocked && userState ? userState.toUpperCase().trim() : '';
    const preservedLeader = isLeaderLocked && userLeader ? userLeader : '';
    setFormState({
      name: '',
      leader: preservedLeader,
      state: preservedState,
      place: '',
      site: '',
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
    setFieldErrors({});
    setPreviewRuleId(null);
    setPreviewDates([]);
  };

  const handleEdit = (rule: CampaignRule) => {
    // Team Leaders can only edit their own rules
    if (isTeamLeader && userLeader && rule.leader?.trim() !== userLeader.trim()) {
      setError('You can only edit your own campaign rules.');
      return;
    }
    setEditingId(rule.id);
    setIsFormExpanded(true); // always show form when editing
    // For SR/TL users with locked state, use the locked state instead of the rule's state
    const stateToUse = isStateLocked && userState ? userState.toUpperCase().trim() : rule.state;
    setFormState({
      name: rule.name,
      leader: rule.leader,
      state: stateToUse,
      place: rule.place,
      site: rule.site,
      time: timeToHHMM(rule.time),
      mobile: rule.mobile || '',
      // 'custom' is no longer a supported frequency type in the UI; fall back to 'weekly'
      frequency_type: (rule.frequency_type === 'custom' ? 'weekly' : rule.frequency_type) as 'weekly' | 'biweekly' | 'monthly',
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
    // Places and leaders are loaded reactively by the useEffects watching formState.state.
    setError(null);
    setSuccess(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleDelete = async (id: string, rule?: CampaignRule) => {
    if (!confirm('Are you sure you want to delete this campaign rule?')) {
      return;
    }
    // Team Leaders can only delete their own rules
    if (isTeamLeader && userLeader) {
      if (!rule || rule.leader?.trim() !== userLeader.trim()) {
        setError('You can only delete your own campaign rules.');
        return;
      }
    }
    try {
      await deleteRule(id);
      setSuccess('Campaign rule deleted successfully');
      await fetchRules();
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Failed to delete campaign rule'));
    }
  };

  const handlePreview = (rule: CampaignRule) => {
    // Toggle off if already showing this rule's preview.
    if (previewRuleId === rule.id) {
      setPreviewRuleId(null);
      setPreviewDates([]);
      return;
    }

    setError(null);

    // Adaptive window: wider for less-frequent rule types so there's always something to show.
    const previewStart = new Date();
    previewStart.setHours(0, 0, 0, 0);
    const previewEnd = new Date(previewStart);
    if (rule.frequency_type === 'monthly') {
      previewEnd.setMonth(previewEnd.getMonth() + 4);      // 4 months
    } else if (rule.frequency_type === 'biweekly') {
      previewEnd.setDate(previewEnd.getDate() + (rule.frequency_value ?? 2) * 7 * 4); // 4 periods
    } else {
      previewEnd.setDate(previewEnd.getDate() + 56);       // 8 weeks for weekly
    }

    try {
      const { dates: previewDatesResult } = previewRuleEvaluation(rule, previewStart, previewEnd);
      setPreviewDates(previewDatesResult);
      setPreviewRuleId(rule.id);
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Failed to preview rule'));
    }
  };

  const handleToggleActive = async (rule: CampaignRule) => {
    // Team Leaders can only toggle their own rules
    if (isTeamLeader && userLeader && rule.leader?.trim() !== userLeader.trim()) {
      setError('You can only update your own campaign rules.');
      return;
    }
    try {
      await setRuleActive(rule.id, !rule.is_active);
      await fetchRules();
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Failed to update rule status'));
    }
  };

  // ── Live "first campaign" hint ─────────────────────────────────────────────
  // Compute the first date the rule would generate a campaign, updating live as
  // the user fills in the form. Shown near the "Active From" field.
  // Must be declared before any early returns to satisfy the Rules of Hooks.
  const firstCampaignDate = useMemo(() => {
    const {
      frequency_type, day_of_week, month_week_number, month_day_of_week,
      frequency_value, start_date, end_date, reference_date,
    } = formState;

    // Monthly requires both week-of-month and day-of-week to be set
    if (frequency_type === 'monthly' && (month_week_number === null || month_day_of_week === null)) return null;

    const tempRule: CampaignRule = {
      id:                '__preview__',
      name:              'preview',
      leader:            formState.leader || '',
      state:             formState.state  || 'NSW',
      place:             formState.place  || 'Preview',
      site:              formState.site,
      time:              formState.time   || '09:00',
      mobile:            null,
      frequency_type,
      frequency_value:   frequency_value ?? null,
      month_week_number: month_week_number ?? null,
      month_day_of_week: month_day_of_week ?? null,
      day_of_week:       day_of_week ?? 0,
      start_date:        start_date || null,
      end_date:          end_date   || null,
      is_active:         true,
      priority:          0,
      rule_config:       reference_date ? { reference_date } : {},
      notes:             null,
    };

    // Search from the Active From date (or today) up to 6 months ahead
    const searchStart = start_date
      ? new Date(start_date + 'T00:00:00')
      : (() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; })();
    const searchEnd = new Date(searchStart);
    searchEnd.setMonth(searchEnd.getMonth() + 6);

    try {
      const campaigns = evaluateRule(tempRule, searchStart, searchEnd);
      return campaigns.length > 0 ? new Date(campaigns[0].date + 'T00:00:00') : null;
    } catch {
      return null;
    }
  }, [
    formState.frequency_type, formState.day_of_week, formState.month_week_number,
    formState.month_day_of_week, formState.frequency_value, formState.start_date,
    formState.end_date, formState.reference_date,
  ]);

  if (isUserLoading) {
    return (
      <MobileLayout>
        <div className="flex min-h-screen items-center justify-center">
          <LoadingSpinner />
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
              onClick={() => router.push(isNonAdmin ? '/app' : '/admin')}
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
              onClick={() => router.push(isNonAdmin ? '/app' : '/admin')}
              className="rounded-md bg-gray-200 px-3 py-2 text-base font-bold text-gray-700 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600 border-2 border-gray-800 dark:border-gray-600"
            >
              {isNonAdmin ? 'Back to Home' : 'Back to Admin Panel'}
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
        <div className="mb-6 rounded-lg border-2 border-gray-800 dark:border-gray-600 bg-blue-50 shadow-sm dark:bg-blue-900/20">
          {/* Collapsible header */}
          <button
            type="button"
            onClick={() => {
              if (isFormExpanded && editingId) { resetForm(); }
              setIsFormExpanded(v => !v);
            }}
            className="flex w-full items-center justify-between p-4 text-left"
          >
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              {editingId ? 'Edit Campaign Rule' : 'Add New Campaign Rule'}
            </h2>
            <span className="ml-2 text-xl text-gray-600 dark:text-gray-400 select-none">
              {isFormExpanded ? '▲' : '▼'}
            </span>
          </button>
          {isFormExpanded && (
          <div className="px-4 pb-4">
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
                  value={combinePlaceAndSite(formState.place, formState.site)}
                  onChange={(e) => {
                    const label = e.target.value;
                    const match = places.find((p) => p.label === label);
                    setFormState({ ...formState, place: match?.place ?? label, site: match?.site ?? '' });
                  }}
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
                    <option key={place.label} value={place.label}>
                      {place.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="leader" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                  Leader * {isLeaderLocked && <span className="text-gray-500 font-normal">(you)</span>}
                </label>
                <select
                  id="leader"
                  required
                  value={formState.leader}
                  onChange={(e) => setFormState({ ...formState, leader: e.target.value })}
                  disabled={isLeaderLocked || !formState.state || loadingLeaders}
                  className="mt-1 block w-full rounded-md border-2 border-gray-400 bg-white px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500 disabled:bg-gray-100 disabled:cursor-not-allowed dark:border-gray-500 dark:bg-gray-900 dark:text-white dark:disabled:bg-gray-700"
                >
                  <option value="">
                    {!formState.state
                      ? 'Select a state first'
                      : isLeaderLocked
                      ? userLeader ?? 'You'
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
                  {TIME_OPTIONS.map((time) => (
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
                onChange={(e) => setFormState({ ...formState, frequency_type: e.target.value as 'weekly' | 'biweekly' | 'monthly' })}
                className="mt-1 block w-full rounded-md border-2 border-gray-400 bg-white px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500 dark:border-gray-500 dark:bg-gray-900 dark:text-white"
              >
                <option value="weekly">Weekly</option>
                <option value="biweekly">Biweekly (Every N weeks)</option>
                <option value="monthly">Monthly</option>
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
                      <select
                        id="frequency_value"
                        required
                        value={formState.frequency_value}
                        onChange={(e) => setFormState({ ...formState, frequency_value: parseInt(e.target.value) })}
                        className="mt-1 block w-full rounded-md border-2 border-gray-400 bg-white px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500 dark:border-gray-500 dark:bg-gray-900 dark:text-white"
                      >
                        {[2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(n => (
                          <option key={n} value={n}>Every {n} weeks</option>
                        ))}
                      </select>
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
                    onChange={(e) => {
                      setFormState({ ...formState, month_week_number: parseInt(e.target.value) || null });
                      setFieldErrors(prev => { const next = { ...prev }; delete next.month_week_number; return next; });
                    }}
                    className={`mt-1 block w-full rounded-md border-2 bg-white px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500 dark:bg-gray-900 dark:text-white ${fieldErrors.month_week_number ? 'border-red-500 dark:border-red-400' : 'border-gray-400 dark:border-gray-500'}`}
                  >
                    <option value="">Select week</option>
                    {MONTH_WEEKS.map((week) => (
                      <option key={week.value} value={week.value}>
                        {week.label}
                      </option>
                    ))}
                  </select>
                  {fieldErrors.month_week_number && (
                    <p className="mt-1 text-xs text-red-600 dark:text-red-400">{fieldErrors.month_week_number}</p>
                  )}
                </div>
                <div>
                  <label htmlFor="month_day_of_week" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                    Day of Week *
                  </label>
                  <select
                    id="month_day_of_week"
                    required
                    value={formState.month_day_of_week !== null ? formState.month_day_of_week : ''}
                    onChange={(e) => {
                      setFormState({ ...formState, month_day_of_week: e.target.value !== '' ? parseInt(e.target.value) : null });
                      setFieldErrors(prev => { const next = { ...prev }; delete next.month_day_of_week; return next; });
                    }}
                    className={`mt-1 block w-full rounded-md border-2 bg-white px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500 dark:bg-gray-900 dark:text-white ${fieldErrors.month_day_of_week ? 'border-red-500 dark:border-red-400' : 'border-gray-400 dark:border-gray-500'}`}
                  >
                    <option value="">Select day</option>
                    {DAYS_OF_WEEK.map((day) => (
                      <option key={day.value} value={day.value}>
                        {day.label}
                      </option>
                    ))}
                  </select>
                  {fieldErrors.month_day_of_week && (
                    <p className="mt-1 text-xs text-red-600 dark:text-red-400">{fieldErrors.month_day_of_week}</p>
                  )}
                </div>
              </>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="start_date" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                  Active From (Optional)
                </label>
                <input
                  id="start_date"
                  type="date"
                  value={formState.start_date}
                  onChange={(e) => setFormState({ ...formState, start_date: e.target.value })}
                  className="mt-1 block w-full rounded-md border-2 border-gray-400 bg-white px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500 dark:border-gray-500 dark:bg-gray-900 dark:text-white"
                />
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  Campaigns won&apos;t be generated before this date. Leave blank to start from the next campaign cycle.
                </p>
                {/* Live first-campaign hint */}
                {firstCampaignDate && (
                  <p className="mt-1.5 rounded-md bg-blue-50 dark:bg-blue-900/30 px-2 py-1 text-xs font-medium text-blue-700 dark:text-blue-300">
                    📅 First campaign under this rule:{' '}
                    {firstCampaignDate.toLocaleDateString('en-AU', {
                      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
                    })}
                  </p>
                )}
                {!firstCampaignDate && formState.start_date && (
                  <p className="mt-1.5 text-xs text-amber-600 dark:text-amber-400">
                    ⚠ No campaigns found in the next 6 months with these settings.
                  </p>
                )}
              </div>
              <div>
                <label htmlFor="end_date" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                  Active Until (Optional)
                </label>
                <input
                  id="end_date"
                  type="date"
                  value={formState.end_date}
                  onChange={(e) => setFormState({ ...formState, end_date: e.target.value })}
                  className="mt-1 block w-full rounded-md border-2 border-gray-400 bg-white px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500 dark:border-gray-500 dark:bg-gray-900 dark:text-white"
                />
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  Campaigns won&apos;t be generated after this date. Leave blank to run indefinitely.
                </p>
              </div>
            </div>

            {/* Priority is a conflict-resolution tool — only meaningful for admins. */}
            <div className={`grid gap-4 ${!isNonAdmin ? 'grid-cols-2' : 'grid-cols-1'}`}>
              {!isNonAdmin && (
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
              )}
              <div className={`flex items-center ${!isNonAdmin ? 'pt-8' : ''}`}>
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
                  onClick={() => { resetForm(); setIsFormExpanded(false); }}
                  className="rounded-md bg-gray-200 px-4 py-2 text-base font-bold text-gray-700 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600 border-2 border-gray-800 dark:border-gray-600"
                >
                  Cancel
                </button>
              )}
            </div>
          </form>
          </div>
          )}
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
                  ? `${MONTH_WEEKS.find(w => w.value === rule.month_week_number)?.label ?? 'Unknown'} of month`
                  : rule.frequency_type === 'biweekly'
                  ? `Every ${rule.frequency_value} weeks`
                  : rule.frequency_type === 'weekly'
                  ? 'Every week'
                  : 'Custom (legacy — not generating campaigns)';

                const dayLabel = rule.day_of_week !== null
                  ? DAYS_OF_WEEK.find(d => d.value === rule.day_of_week)?.label
                  : rule.month_day_of_week !== null
                  ? DAYS_OF_WEEK.find(d => d.value === rule.month_day_of_week)?.label
                  : null;

                // Expiry warning: amber if the rule ends within the next 30 days.
                const today = new Date(); today.setHours(0, 0, 0, 0);
                const endDate = rule.end_date ? new Date(rule.end_date + 'T00:00:00') : null;
                const expiringSoon = endDate !== null
                  && endDate >= today
                  && endDate.getTime() - today.getTime() <= 30 * 24 * 60 * 60 * 1000;

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
                          {rule.leader} - {combinePlaceAndSite(rule.place, rule.site)}, {rule.state} at {timeToHHMM(rule.time)}
                        </div>
                        <div className={`text-xs ${stateColor.text} opacity-60 mt-1`}>
                          {frequencyLabel}{dayLabel ? ` on ${dayLabel}` : ''}
                        </div>
                        {(rule.start_date || rule.end_date) && (
                          <div className={`text-xs mt-0.5 ${expiringSoon ? 'font-medium text-amber-600 dark:text-amber-400' : `${stateColor.text} opacity-60`}`}>
                            {rule.start_date ? `Active from ${rule.start_date}` : ''}
                            {rule.start_date && rule.end_date ? ' · ' : ''}
                            {rule.end_date ? `Until ${rule.end_date}` : ''}
                            {expiringSoon ? ' ⚠ Expiring soon' : ''}
                          </div>
                        )}
                        {rule.notes && (
                          <div className={`text-xs ${stateColor.text} opacity-60 mt-1 italic`}>
                            {rule.notes}
                          </div>
                        )}
                        {previewRuleId === rule.id && (
                          <div className="mt-2 rounded bg-white/50 p-2 dark:bg-gray-900/50">
                            <div className="text-xs font-medium text-gray-700 dark:text-gray-300">
                              Upcoming campaign dates:
                            </div>
                            {previewDates.length > 0 ? (
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
                          onClick={() => handleDelete(rule.id, rule)}
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

      {/* ── Create-confirmation modal ──────────────────────────────────────── */}
      {showConfirmModal && pendingRuleData && (
        <Modal position="bottom" onClose={handleCancelConfirm}>
          <div className="w-full max-w-lg rounded-t-2xl bg-white p-6 shadow-xl dark:bg-gray-900 sm:rounded-2xl">

            {/* Header */}
            <h2 className="mb-1 text-xl font-bold text-gray-900 dark:text-gray-100">
              Confirm New Campaign Rule
            </h2>
            <p className="mb-5 text-sm text-gray-500 dark:text-gray-400">
              Please review what this rule will do before confirming.
            </p>

            {/* Rule summary card */}
            <div className="mb-5 rounded-lg border-2 border-blue-200 bg-blue-50 p-4 dark:border-blue-800 dark:bg-blue-900/20">
              <div className="mb-3 text-sm font-semibold text-blue-900 dark:text-blue-200">
                {pendingRuleData.name}
              </div>
              <div className="space-y-1 text-sm text-blue-800 dark:text-blue-300">
                <div>
                  <span className="font-medium">Who: </span>
                  {pendingRuleData.leader}
                </div>
                <div>
                  <span className="font-medium">Where: </span>
                  {combinePlaceAndSite(pendingRuleData.place, pendingRuleData.site)}, {pendingRuleData.state}
                </div>
                <div>
                  <span className="font-medium">Time: </span>
                  {TIME_OPTIONS.find(t => t.value === pendingRuleData.time)?.label ?? pendingRuleData.time}
                </div>
                <div>
                  <span className="font-medium">Schedule: </span>
                  {buildScheduleSummary(
                    pendingRuleData.frequency_type as 'weekly' | 'biweekly' | 'monthly',
                    pendingRuleData.day_of_week ?? 0,
                    pendingRuleData.month_week_number,
                    pendingRuleData.month_day_of_week,
                    pendingRuleData.frequency_value ?? 2,
                  )}
                </div>
                {pendingRuleData.start_date && (
                  <div>
                    <span className="font-medium">Starting: </span>
                    {new Date(pendingRuleData.start_date + 'T00:00:00').toLocaleDateString('en-AU', {
                      day: 'numeric', month: 'long', year: 'numeric',
                    })}
                  </div>
                )}
                {pendingRuleData.end_date && (
                  <div>
                    <span className="font-medium">Until: </span>
                    {new Date(pendingRuleData.end_date + 'T00:00:00').toLocaleDateString('en-AU', {
                      day: 'numeric', month: 'long', year: 'numeric',
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* Upcoming dates */}
            <div className="mb-5">
              <p className="mb-2 text-sm font-semibold text-gray-700 dark:text-gray-300">
                📅 Next upcoming campaign dates:
              </p>
              {confirmDates.length > 0 ? (
                <ul className="space-y-1">
                  {confirmDates.map(dateStr => (
                    <li key={dateStr} className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                      <span className="text-green-500">✓</span>
                      {new Date(dateStr + 'T00:00:00').toLocaleDateString('en-AU', {
                        weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
                      })}
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-300">
                  ⚠ No campaigns will be generated in the next 6 months with these settings.
                  You can still create the rule and activate it later, or go back and adjust the settings.
                </div>
              )}
            </div>

            {/* Footer note */}
            <p className="mb-5 text-xs text-gray-500 dark:text-gray-400">
              Campaigns are created automatically during the weekly system refresh.
              You can edit, deactivate, or delete this rule at any time.
            </p>

            {/* Actions */}
            <div className="flex gap-3">
              <button
                type="button"
                onClick={handleCancelConfirm}
                className="flex-1 rounded-md border-2 border-gray-400 bg-white px-4 py-2.5 text-base font-bold text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
              >
                ← Go Back
              </button>
              <button
                type="button"
                onClick={handleConfirmCreate}
                disabled={isSubmitting}
                className="flex-1 rounded-md border-2 border-gray-800 bg-blue-600 px-4 py-2.5 text-base font-bold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600"
              >
                {isSubmitting ? 'Creating…' : 'Confirm & Create'}
              </button>
            </div>
          </div>
        </Modal>
      )}
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
