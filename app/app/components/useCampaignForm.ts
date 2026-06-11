'use client';
import { useState, useEffect } from 'react';
import { getLeaderMobile } from '@/lib/services/dropdownService';
import { addNewPlaceForState } from '@/lib/services/placeService';
import { getErrorMessage } from '@/lib/errorUtils';
import { useStateDropdowns } from './useStateDropdowns';

export interface CampaignFormValues {
  date: string;
  state: string;
  place: string;
  time: string;
  leader: string;
  mobile: string;
  category: string;
  tl_ok: boolean;
  sr_ok: boolean;
}

interface UseCampaignFormOptions {
  initialValues: CampaignFormValues;
  /** Called with resolved values (custom place already persisted and returned as `place`). */
  onSubmit: (values: CampaignFormValues) => Promise<void>;
  /** Auto-fill leader/mobile for non-admin users when leaders load. */
  autoFill?: {
    isAdmin: boolean;
    userMobileAndLeader: { mobile: string | null; leader: string | null } | null;
    userState: string | null;
  };
}

export function useCampaignForm({ initialValues, onSubmit, autoFill }: UseCampaignFormOptions) {
  const [values, setValues] = useState<CampaignFormValues>(initialValues);
  const [isOtherPlace, setIsOtherPlace] = useState(false);
  const [customPlace, setCustomPlace] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { places, leaders, loadingPlaces, loadingLeaders, updatePlacesCache } =
    useStateDropdowns(values.state);

  // Auto-fill leader/mobile for non-admin users once leaders list loads
  useEffect(() => {
    if (!autoFill) return;
    const { isAdmin, userMobileAndLeader, userState } = autoFill;
    if (isAdmin || !userMobileAndLeader?.leader || values.leader || loadingLeaders) return;
    const stateMatches =
      (values.state || '').toUpperCase().trim() === (userState || '').toUpperCase().trim();
    if (!stateMatches || !leaders.includes(userMobileAndLeader.leader)) return;
    setValues((prev) => ({
      ...prev,
      leader: userMobileAndLeader.leader ?? prev.leader,
      mobile: userMobileAndLeader.mobile || prev.mobile,
    }));
  }, [autoFill, values.state, values.leader, leaders, loadingLeaders]);

  const setValue = <K extends keyof CampaignFormValues>(field: K, value: CampaignFormValues[K]) => {
    setValues((prev) => ({ ...prev, [field]: value }));
  };

  const handleStateChange = (newState: string) => {
    setValues((prev) => ({ ...prev, state: newState, place: '', leader: '', mobile: '' }));
    setIsOtherPlace(false);
    setCustomPlace('');
  };

  const handleLeaderChange = async (leader: string) => {
    if (leader && values.state) {
      const mobile = await getLeaderMobile(values.state, leader);
      setValues((prev) => ({ ...prev, leader, mobile: mobile || '' }));
    } else {
      setValues((prev) => ({ ...prev, leader: '', mobile: '' }));
    }
  };

  const handlePlaceChange = (place: string) => {
    if (place === 'OTHER_PLACE') {
      setIsOtherPlace(true);
      setValues((prev) => ({ ...prev, place: '', leader: '', mobile: '' }));
    } else {
      setIsOtherPlace(false);
      setCustomPlace('');
      setValues((prev) => ({ ...prev, place, leader: '', mobile: '' }));
    }
  };

  /** Call from a form's onSubmit or a button's onClick — handles both event types. */
  const handleSubmit = async (e: React.FormEvent | React.MouseEvent) => {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      let resolvedPlace = values.place;
      if (isOtherPlace && customPlace.trim()) {
        if (!values.state?.trim()) throw new Error('Please select a state before entering a new place');
        const stateValue = values.state.toUpperCase().trim();
        const newPlace   = customPlace.trim();
        await addNewPlaceForState(stateValue, newPlace);
        resolvedPlace = newPlace;
        const { getPlacesForState } = await import('@/lib/services/dropdownService');
        updatePlacesCache(stateValue, await getPlacesForState(stateValue));
      }
      if (!resolvedPlace?.trim()) throw new Error('Please select or enter a place');
      await onSubmit({ ...values, place: resolvedPlace });
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Failed to save campaign'));
    } finally {
      setIsSubmitting(false);
    }
  };

  return {
    values,
    setValue,
    isOtherPlace,
    customPlace,
    setCustomPlace,
    places,
    leaders,
    loadingPlaces,
    loadingLeaders,
    isSubmitting,
    error,
    handleSubmit,
    handleStateChange,
    handleLeaderChange,
    handlePlaceChange,
  };
}
