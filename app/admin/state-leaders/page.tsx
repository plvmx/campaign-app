'use client';

import { useEffect, useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import MobileLayout from '@/components/MobileLayout';
import LoadingSpinner from '@/components/LoadingSpinner';
import { useUser } from '@/contexts/UserContext';
import { supabase } from '@/lib/supabaseClient';
import { getStateColor } from '@/lib/stateColors';
import { AUSTRALIAN_STATES } from '@/lib/constants';
import { getErrorMessage } from '@/lib/errorUtils';

async function revokeSessionsForLeader(state: string, leader: string): Promise<void> {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) return;
  await fetch('/api/admin/invalidate-user-session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({ state, leader }),
  });
}

interface StateLeader {
  id: string;
  state: string;
  leader: string;
  mobile: string | null;
  admin: string | null;
  created_at: string;
}

export default function StateLeadersPage() {
  const router = useRouter();
  const { user, isAdmin, isLoading: isUserLoading } = useUser();
  const [hasAccess, setHasAccess] = useState(false);
  const [stateLeaders, setStateLeaders] = useState<StateLeader[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  
  // Form state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formState, setFormState] = useState({ state: '', leader: '', mobile: '', admin: '' });
  const [filterState, setFilterState] = useState<string>('');
  const [filterName, setFilterName]   = useState<string>('');
  const [filterMobile, setFilterMobile] = useState<string>('');

  useEffect(() => {
    if (isUserLoading) return;
    if (!user) { router.push('/login'); return; }
    if (!isAdmin) {
      setError('You do not have permission to access this page');
      return;
    }
    setHasAccess(true);
    fetchStateLeaders();
  }, [isUserLoading, user, isAdmin, router]);

  const fetchStateLeaders = async () => {
    try {
      let query = supabase.from('state_leaders').select('*').order('state', { ascending: true }).order('leader', { ascending: true });
      
      if (filterState) {
        query = query.eq('state', filterState);
      }
      
      const { data, error } = await query;
      
      if (error) throw error;
      setStateLeaders(data || []);
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Failed to fetch state leaders'));
    }
  };

  useEffect(() => {
    if (hasAccess) {
      fetchStateLeaders();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterState, hasAccess]);

  // Dropdown options derived from already-fetched data, scoped to the selected state.
  // Must be declared before any early returns to satisfy Rules of Hooks.
  const filterNameOptions = useMemo(() => {
    const source = filterState ? stateLeaders.filter(sl => sl.state === filterState) : stateLeaders;
    return [...new Set(source.map(sl => sl.leader))].sort();
  }, [stateLeaders, filterState]);

  const filterMobileOptions = useMemo(() => {
    const source = filterState ? stateLeaders.filter(sl => sl.state === filterState) : stateLeaders;
    return [...new Set(source.map(sl => sl.mobile).filter((m): m is string => !!m))].sort();
  }, [stateLeaders, filterState]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setIsSubmitting(true);

    try {
      const leaderValue = formState.leader.trim();
      const mobileValue = formState.mobile.trim() || null;
      const adminValue = formState.admin.trim() || null;

      if (editingId) {
        const originalItem = stateLeaders.find(sl => sl.id === editingId);
        const { error } = await supabase
          .from('state_leaders')
          .update({
            state: formState.state,
            leader: leaderValue,
            mobile: mobileValue,
            admin: adminValue
          })
          .eq('id', editingId);

        if (error) throw error;
        setSuccess('State leader updated successfully');

        // If admin status changed (granted or revoked), force-sign-out the
        // affected user immediately so the change takes effect without waiting
        // for their next JWT refresh cycle (~1 hour).
        const adminChanged = originalItem && (originalItem.admin ?? null) !== adminValue;
        if (adminChanged) {
          void revokeSessionsForLeader(formState.state, leaderValue);
        }
      } else {
        // Create new record
        const { error } = await supabase
          .from('state_leaders')
          .insert([{
            state: formState.state,
            leader: leaderValue,
            mobile: mobileValue,
            admin: adminValue
          }]);

        if (error) {
          if (error.code === '23505') {
            throw new Error('This state-leader combination already exists');
          }
          throw error;
        }
        setSuccess('State leader created successfully');
      }

      // Reset form
      setFormState({ state: '', leader: '', mobile: '', admin: '' });
      setEditingId(null);
      await fetchStateLeaders();
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Failed to save state leader'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleEdit = (item: StateLeader) => {
    setEditingId(item.id);
    setFormState({
      state: item.state,
      leader: item.leader,
      mobile: item.mobile || '',
      admin: item.admin || ''
    });
    setError(null);
    setSuccess(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this state-leader combination?')) {
      return;
    }

    try {
      const { error } = await supabase.from('state_leaders').delete().eq('id', id);
      if (error) throw error;
      setSuccess('State leader deleted successfully');
      await fetchStateLeaders();
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Failed to delete state leader'));
    }
  };

  const handleCancel = () => {
    setEditingId(null);
    setFormState({ state: '', leader: '', mobile: '', admin: '' });
    setError(null);
    setSuccess(null);
  };

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
              onClick={() => router.push('/admin')}
              className="mt-4 rounded-md bg-red-600 px-4 py-2 text-base font-bold text-white hover:bg-red-700 border-2 border-gray-800 dark:border-gray-600"
            >
              Go Back
            </button>
          </div>
        </div>
      </MobileLayout>
    );
  }

  const filteredLeaders = stateLeaders.filter((sl) => {
    if (filterState  && sl.state !== filterState) return false;
    if (filterName   && !sl.leader.toLowerCase().includes(filterName.toLowerCase())) return false;
    if (filterMobile && !(sl.mobile ?? '').toLowerCase().includes(filterMobile.toLowerCase())) return false;
    return true;
  });

  return (
    <MobileLayout>
      <div className="p-4">
        <div className="mb-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                Manage State Leaders
              </h1>
              <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                Add, edit, or remove state-leader combinations
              </p>
            </div>
            <button
              onClick={() => router.push('/admin')}
              className="rounded-md bg-gray-200 px-3 py-2 text-base font-bold text-gray-700 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600 border-2 border-gray-800 dark:border-gray-600"
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
            {editingId ? 'Edit State Leader' : 'Add New State Leader'}
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
              <label htmlFor="leader" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                Leader
              </label>
              <input
                id="leader"
                type="text"
                required
                value={formState.leader}
                onChange={(e) => setFormState({ ...formState, leader: e.target.value })}
                className="mt-1 block w-full rounded-md border-2 border-gray-400 bg-white px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500 dark:border-gray-500 dark:bg-gray-900 dark:text-white"
                placeholder="Enter leader name"
              />
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
              <label htmlFor="admin" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                Admin (Optional)
              </label>
              <input
                id="admin"
                type="text"
                value={formState.admin}
                onChange={(e) => setFormState({ ...formState, admin: e.target.value })}
                className="mt-1 block w-full rounded-md border-2 border-gray-400 bg-white px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500 dark:border-gray-500 dark:bg-gray-900 dark:text-white"
                placeholder="Enter admin name"
              />
            </div>
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={isSubmitting}
                className="flex-1 rounded-md bg-blue-600 px-4 py-2 text-base font-bold text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed border-2 border-gray-800 dark:border-gray-600"
              >
                {isSubmitting ? 'Saving...' : editingId ? 'Update' : 'Add'}
              </button>
              {editingId && (
                <button
                  type="button"
                  onClick={handleCancel}
                  className="rounded-md bg-gray-200 px-4 py-2 text-base font-bold text-gray-700 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600 border-2 border-gray-800 dark:border-gray-600"
                >
                  Cancel
                </button>
              )}
            </div>
          </form>
        </div>

        {/* Filters */}
        <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div>
            <label htmlFor="filter-state" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
              Filter by State
            </label>
            <select
              id="filter-state"
              value={filterState}
              onChange={(e) => { setFilterState(e.target.value); setFilterName(''); setFilterMobile(''); }}
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
          <div>
            <label htmlFor="filter-name" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
              Filter by Name
            </label>
            <select
              id="filter-name"
              value={filterName}
              onChange={(e) => setFilterName(e.target.value)}
              className="mt-1 block w-full rounded-md border-2 border-gray-400 bg-white px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500 dark:border-gray-500 dark:bg-gray-900 dark:text-white"
            >
              <option value="">All Names</option>
              {filterNameOptions.map((name) => (
                <option key={name} value={name}>{name}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="filter-mobile" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
              Filter by Mobile
            </label>
            <select
              id="filter-mobile"
              value={filterMobile}
              onChange={(e) => setFilterMobile(e.target.value)}
              className="mt-1 block w-full rounded-md border-2 border-gray-400 bg-white px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500 dark:border-gray-500 dark:bg-gray-900 dark:text-white"
            >
              <option value="">All Mobiles</option>
              {filterMobileOptions.map((mobile) => (
                <option key={mobile} value={mobile}>{mobile}</option>
              ))}
            </select>
          </div>
        </div>

        {/* List of State Leaders */}
        <div className="rounded-lg border-2 border-gray-800 dark:border-gray-600 bg-white shadow-sm dark:bg-gray-800">
          <div className="p-4">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              State Leaders ({filteredLeaders.length})
            </h2>
          </div>
          <div className="divide-y divide-gray-200 dark:divide-gray-700">
            {filteredLeaders.length === 0 ? (
              <div className="p-4 text-center text-sm text-gray-500 dark:text-gray-400">
                No state leaders found
              </div>
            ) : (
              filteredLeaders.map((item) => {
                const stateColor = getStateColor(item.state);
                return (
                  <div key={item.id} className={`p-4 ${stateColor.bg}`}>
                    <div className="flex items-center justify-between">
                      <div>
                        <div className={`font-medium ${stateColor.text}`}>
                          {item.leader}
                        </div>
                        <div className={`text-sm ${stateColor.text} opacity-75`}>
                          {item.state}
                        </div>
                        {item.mobile && (
                          <div className={`text-xs ${stateColor.text} opacity-60 mt-1`}>
                            {item.mobile}
                          </div>
                        )}
                        {item.admin && (
                          <div className={`text-xs ${stateColor.text} opacity-60 mt-1`}>
                            Admin: {item.admin}
                          </div>
                        )}
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

