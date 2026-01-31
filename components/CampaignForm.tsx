'use client';

import { useState, FormEvent, useEffect } from 'react';
import { supabase } from '@/lib/supabaseClient';

export interface CampaignData {
  date: string;
  state: string;
  place: string;
  time: string;
  leader: string;
  mobile: string;
  botj: string;
}

interface CampaignFormProps {
  onSubmit: (data: CampaignData) => Promise<void> | void;
  initialData?: Partial<CampaignData>;
  submitLabel?: string;
}

export default function CampaignForm({
  onSubmit,
  initialData,
  submitLabel = 'Create Campaign',
}: CampaignFormProps) {
  // Get today's date in YYYY-MM-DD format for default value and min attribute
  const getTodayDateString = () => {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  // Calculate today's date string once for use in min attribute and default value
  const todayDateString = getTodayDateString();

  const [formData, setFormData] = useState<CampaignData>({
    date: initialData?.date || todayDateString,
    state: initialData?.state || '',
    place: initialData?.place || '',
    time: initialData?.time || '',
    leader: initialData?.leader || '',
    mobile: initialData?.mobile || '',
    botj: initialData?.botj ?? 'No',
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [places, setPlaces] = useState<string[]>([]);
  const [loadingPlaces, setLoadingPlaces] = useState(false);
  const [timeOptions, setTimeOptions] = useState<{ value: string; label: string }[]>([]);
  const [leaders, setLeaders] = useState<string[]>([]);
  const [loadingLeaders, setLoadingLeaders] = useState(false);

  // Generate time options (half-hour intervals from 8:00 AM to 9:00 PM)
  useEffect(() => {
    function generateTimeOptions() {
      const times: { value: string; label: string }[] = [];
      
      // Start at 8:00 AM (8 * 60 = 480 minutes)
      // End at 9:00 PM (21 * 60 = 1260 minutes)
      // Interval: 30 minutes
      for (let minutes = 480; minutes <= 1260; minutes += 30) {
        const hours = Math.floor(minutes / 60);
        const mins = minutes % 60;
        
        // Format as HH:MM for value (24-hour format for database)
        const value = `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
        
        // Format for display (12-hour format with AM/PM)
        const displayHours = hours === 0 ? 12 : hours > 12 ? hours - 12 : hours;
        const ampm = hours >= 12 ? 'PM' : 'AM';
        const label = `${displayHours}:${String(mins).padStart(2, '0')} ${ampm}`;
        
        times.push({ value, label });
      }
      
      setTimeOptions(times);
    }

    generateTimeOptions();
  }, []);

  // Fetch places from state_places table when state changes
  useEffect(() => {
    async function fetchPlaces() {
      if (!formData.state) {
        setPlaces([]);
        return;
      }

      setLoadingPlaces(true);
      try {
        const { data, error } = await supabase
          .from('state_places')
          .select('place')
          .eq('state', formData.state)
          .order('place', { ascending: true });

        if (error) throw error;

        // Get unique places (should already be unique due to UNIQUE constraint, but just in case)
        const uniquePlaces = Array.from(
          new Set((data || []).map((item) => item.place).filter(Boolean))
        ).sort();

        setPlaces(uniquePlaces);
        
        // If current place is not in the filtered list, clear it
        if (formData.place && !uniquePlaces.includes(formData.place)) {
          setFormData((prev) => ({ ...prev, place: '' }));
        }
      } catch (err) {
        console.error('Error fetching places:', err);
        setPlaces([]);
      } finally {
        setLoadingPlaces(false);
      }
    }

    fetchPlaces();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formData.state]);

  // Fetch leaders from state_leaders table when state changes
  useEffect(() => {
    async function fetchLeaders() {
      if (!formData.state) {
        setLeaders([]);
        return;
      }

      setLoadingLeaders(true);
      try {
        const { data, error } = await supabase
          .from('state_leaders')
          .select('leader')
          .eq('state', formData.state)
          .order('leader', { ascending: true });

        if (error) throw error;

        // Get unique leaders (should already be unique due to UNIQUE constraint, but just in case)
        const uniqueLeaders = Array.from(
          new Set((data || []).map((item) => item.leader).filter(Boolean))
        ).sort();

        setLeaders(uniqueLeaders);

        // If current leader is not in the filtered list, clear it
        if (formData.leader && !uniqueLeaders.includes(formData.leader)) {
          setFormData((prev) => ({ ...prev, leader: '' }));
        }
      } catch (err) {
        console.error('Error fetching leaders:', err);
        setLeaders([]);
      } finally {
        setLoadingLeaders(false);
      }
    }

    fetchLeaders();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formData.state]);

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: value,
      // Clear place when state changes
      ...(name === 'state' ? { place: '' } : {}),
    }));
    setError(null);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      await onSubmit(formData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 p-4">
      {error && (
        <div className="rounded-md bg-red-50 p-3 text-sm text-red-800 dark:bg-red-900/20 dark:text-red-200">
          {error}
        </div>
      )}

      <div>
        <label
          htmlFor="date"
          className="block text-sm font-medium text-gray-700 dark:text-gray-300"
        >
          Date *
        </label>
        <input
          type="date"
          id="date"
          name="date"
          required
          value={formData.date}
          onChange={handleChange}
          className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
        />
      </div>

      <div>
        <label
          htmlFor="state"
          className="block text-sm font-medium text-gray-700 dark:text-gray-300"
        >
          State *
        </label>
        <select
          id="state"
          name="state"
          required
          value={formData.state}
          onChange={handleChange}
          className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
        >
          <option value="">Select a state</option>
          <option value="VIC">Victoria (VIC)</option>
          <option value="NSW">New South Wales (NSW)</option>
          <option value="QLD">Queensland (QLD)</option>
          <option value="SA">South Australia (SA)</option>
          <option value="WA">Western Australia (WA)</option>
          <option value="TAS">Tasmania (TAS)</option>
          <option value="NT">Northern Territory (NT)</option>
          <option value="ACT">Australian Capital Territory (ACT)</option>
        </select>
      </div>

      <div>
        <label
          htmlFor="place"
          className="block text-sm font-medium text-gray-700 dark:text-gray-300"
        >
          Place *
        </label>
        <select
          id="place"
          name="place"
          required
          value={formData.place}
          onChange={handleChange}
          disabled={!formData.state || loadingPlaces}
          className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500 disabled:bg-gray-100 disabled:cursor-not-allowed dark:border-gray-600 dark:bg-gray-800 dark:text-white dark:disabled:bg-gray-700"
        >
          <option value="">
            {!formData.state
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
        {formData.state && places.length === 0 && !loadingPlaces && (
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            No potential campaigns found for {formData.state}. You can still create a campaign manually.
          </p>
        )}
      </div>

      <div>
        <label
          htmlFor="time"
          className="block text-sm font-medium text-gray-700 dark:text-gray-300"
        >
          Time *
        </label>
        <select
          id="time"
          name="time"
          required
          value={formData.time}
          onChange={handleChange}
          className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
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
        <label
          htmlFor="leader"
          className="block text-sm font-medium text-gray-700 dark:text-gray-300"
        >
          Leader *
        </label>
        <select
          id="leader"
          name="leader"
          required
          value={formData.leader}
          onChange={handleChange}
          disabled={!formData.state || loadingLeaders}
          className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500 disabled:bg-gray-100 disabled:cursor-not-allowed dark:border-gray-600 dark:bg-gray-800 dark:text-white dark:disabled:bg-gray-700"
        >
          <option value="">
            {!formData.state
              ? 'Select a state first'
              : loadingLeaders
              ? 'Loading leaders...'
              : leaders.length === 0
              ? 'No leaders found'
              : 'Select a leader'}
          </option>
          {leaders.map((leader) => (
            <option key={leader} value={leader}>
              {leader}
            </option>
          ))}
        </select>
        {formData.state && leaders.length === 0 && !loadingLeaders && (
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            No leaders found for {formData.place ? `${formData.place}, ` : ''}
            {formData.state}.
          </p>
        )}
      </div>

      <div>
        <label
          htmlFor="mobile"
          className="block text-sm font-medium text-gray-700 dark:text-gray-300"
        >
          Mobile (Optional)
        </label>
        <input
          id="mobile"
          name="mobile"
          type="tel"
          value={formData.mobile}
          onChange={handleChange}
          className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
          placeholder="Enter mobile number"
          inputMode="tel"
        />
      </div>

      <div>
        <label
          htmlFor="botj"
          className="block text-sm font-medium text-gray-700 dark:text-gray-300"
        >
          BOTJ
        </label>
        <select
          id="botj"
          name="botj"
          required
          value={formData.botj}
          onChange={(e) => {
            setFormData((prev) => ({
              ...prev,
              botj: e.target.value,
            }));
            setError(null);
          }}
          className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
        >
          <option value="No">No</option>
          <option value="Yes">Yes</option>
        </select>
      </div>

      <button
        type="submit"
        disabled={isSubmitting}
        className="w-full rounded-md bg-blue-600 px-4 py-2 text-base font-bold text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed border-2 border-gray-800 dark:border-gray-600"
      >
        {isSubmitting ? 'Submitting...' : submitLabel}
      </button>
    </form>
  );
}

