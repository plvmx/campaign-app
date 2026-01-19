'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import MobileLayout from '@/components/MobileLayout';
import { getCurrentUser } from '@/lib/auth';
import { hasPermission, Permission } from '@/lib/permissions';
import { supabase } from '@/lib/supabaseClient';
import { getStateColor } from '@/lib/stateColors';

interface StatePlace {
  id: string;
  state: string;
  place: string;
  created_at: string;
}

const AUSTRALIAN_STATES = ['ACT', 'NSW', 'QLD', 'SA', 'TAS', 'VIC', 'WA', 'NT'];

export default function StatePlacesPage() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(true);
  const [hasAccess, setHasAccess] = useState(false);
  const [statePlaces, setStatePlaces] = useState<StatePlace[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  
  // Form state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formState, setFormState] = useState({ state: '', place: '' });
  const [filterState, setFilterState] = useState<string>('');

  useEffect(() => {
    async function checkAuthAndPermissions() {
      try {
        const currentUser = await getCurrentUser();
        if (!currentUser) {
          router.push('/login');
          return;
        }

        const canAccess = await hasPermission(Permission.ADMIN_ACCESS);
        if (!canAccess) {
          setError('You do not have permission to access this page');
          return;
        }
        setHasAccess(true);
        await fetchStatePlaces();
      } catch (err: any) {
        setError(err.message || 'Access denied');
      } finally {
        setIsLoading(false);
      }
    }
    checkAuthAndPermissions();
  }, [router]);

  const fetchStatePlaces = async () => {
    try {
      let query = supabase.from('state_places').select('*').order('state', { ascending: true }).order('place', { ascending: true });
      
      if (filterState) {
        query = query.eq('state', filterState);
      }
      
      const { data, error } = await query;
      
      if (error) throw error;
      setStatePlaces(data || []);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch state places');
    }
  };

  useEffect(() => {
    if (hasAccess) {
      fetchStatePlaces();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterState, hasAccess]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setIsSubmitting(true);

    try {
      if (editingId) {
        // Update existing record
        const { error } = await supabase
          .from('state_places')
          .update({ state: formState.state, place: formState.place })
          .eq('id', editingId);

        if (error) throw error;
        setSuccess('State place updated successfully');
      } else {
        // Create new record
        const { error } = await supabase
          .from('state_places')
          .insert([{ state: formState.state, place: formState.place }]);

        if (error) {
          if (error.code === '23505') {
            throw new Error('This state-place combination already exists');
          }
          throw error;
        }
        setSuccess('State place created successfully');
      }

      // Reset form
      setFormState({ state: '', place: '' });
      setEditingId(null);
      await fetchStatePlaces();
    } catch (err: any) {
      setError(err.message || 'Failed to save state place');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleEdit = (item: StatePlace) => {
    setEditingId(item.id);
    setFormState({ state: item.state, place: item.place });
    setError(null);
    setSuccess(null);
    // Scroll to form
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this state-place combination?')) {
      return;
    }

    try {
      const { error } = await supabase.from('state_places').delete().eq('id', id);
      if (error) throw error;
      setSuccess('State place deleted successfully');
      await fetchStatePlaces();
    } catch (err: any) {
      setError(err.message || 'Failed to delete state place');
    }
  };

  const handleCancel = () => {
    setEditingId(null);
    setFormState({ state: '', place: '' });
    setError(null);
    setSuccess(null);
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
              onClick={() => router.push('/admin')}
              className="mt-4 rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
            >
              Go Back
            </button>
          </div>
        </div>
      </MobileLayout>
    );
  }

  const filteredPlaces = filterState
    ? statePlaces.filter(sp => sp.state === filterState)
    : statePlaces;

  return (
    <MobileLayout>
      <div className="p-4">
        <div className="mb-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                Manage State Places
              </h1>
              <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                Add, edit, or remove state-place combinations
              </p>
            </div>
            <button
              onClick={() => router.push('/admin')}
              className="rounded-md bg-gray-200 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600"
            >
              Back
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
            {editingId ? 'Edit State Place' : 'Add New State Place'}
          </h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="state" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                State
              </label>
              <select
                id="state"
                required
                value={formState.state}
                onChange={(e) => setFormState({ ...formState, state: e.target.value })}
                className="mt-1 block w-full rounded-md border-2 border-gray-400 bg-white px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500 dark:border-gray-500 dark:bg-gray-900 dark:text-white"
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
              <input
                id="place"
                type="text"
                required
                value={formState.place}
                onChange={(e) => setFormState({ ...formState, place: e.target.value })}
                className="mt-1 block w-full rounded-md border-2 border-gray-400 bg-white px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500 dark:border-gray-500 dark:bg-gray-900 dark:text-white"
                placeholder="Enter place name"
              />
            </div>
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={isSubmitting}
                className="flex-1 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSubmitting ? 'Saving...' : editingId ? 'Update' : 'Add'}
              </button>
              {editingId && (
                <button
                  type="button"
                  onClick={handleCancel}
                  className="rounded-md bg-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600"
                >
                  Cancel
                </button>
              )}
            </div>
          </form>
        </div>

        {/* Filter */}
        <div className="mb-4">
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

        {/* List of State Places */}
        <div className="rounded-lg border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
          <div className="p-4">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              State Places ({filteredPlaces.length})
            </h2>
          </div>
          <div className="divide-y divide-gray-200 dark:divide-gray-700">
            {filteredPlaces.length === 0 ? (
              <div className="p-4 text-center text-sm text-gray-500 dark:text-gray-400">
                No state places found
              </div>
            ) : (
              filteredPlaces.map((item) => {
                const stateColor = getStateColor(item.state);
                return (
                  <div key={item.id} className={`p-4 ${stateColor.bg}`}>
                    <div className="flex items-center justify-between">
                      <div>
                        <div className={`font-medium ${stateColor.text}`}>
                          {item.place}
                        </div>
                        <div className={`text-sm ${stateColor.text} opacity-75`}>
                          {item.state}
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleEdit(item)}
                          className="rounded-md bg-blue-100 px-3 py-1 text-sm font-medium text-blue-700 hover:bg-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:hover:bg-blue-900/50"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleDelete(item.id)}
                          className="rounded-md bg-red-100 px-3 py-1 text-sm font-medium text-red-700 hover:bg-red-200 dark:bg-red-900/30 dark:text-red-300 dark:hover:bg-red-900/50"
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

