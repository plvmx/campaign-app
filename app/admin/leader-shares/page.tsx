'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import MobileLayout from '@/components/MobileLayout';
import { useUser } from '@/contexts/UserContext';
import { supabase } from '@/lib/supabaseClient';
import { getStateColor } from '@/lib/stateColors';
import { AUSTRALIAN_STATES } from '@/lib/constants';
import { getErrorMessage } from '@/lib/errorUtils';

interface LeaderShare {
  id: string;
  owner_state: string;
  owner_leader: string;
  shared_with_state: string;
  shared_with_leader: string;
  created_at: string;
}

interface StateLeaderOption {
  state: string;
  leader: string;
}

export default function LeaderSharesPage() {
  const router = useRouter();
  const { user, isAdmin, isLoading: isUserLoading } = useUser();
  const [hasAccess, setHasAccess] = useState(false);
  const [shares, setShares] = useState<LeaderShare[]>([]);
  const [stateLeaders, setStateLeaders] = useState<StateLeaderOption[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [formState, setFormState] = useState({
    owner_state: '',
    owner_leader: '',
    shared_with_state: '',
    shared_with_leader: '',
  });

  useEffect(() => {
    if (isUserLoading) return;
    if (!user) { router.push('/login'); return; }
    if (!isAdmin) {
      setError('You do not have permission to access this page');
      return;
    }
    setHasAccess(true);
  }, [isUserLoading, user, isAdmin, router]);

  const fetchShares = async () => {
    try {
      const { data, error: fetchError } = await supabase
        .from('leader_shares')
        .select('*')
        .order('owner_state', { ascending: true })
        .order('owner_leader', { ascending: true });
      if (fetchError) throw fetchError;
      setShares(data || []);
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Failed to fetch leader shares'));
    }
  };

  const fetchStateLeaders = async () => {
    try {
      const { data, error: fetchError } = await supabase
        .from('state_leaders')
        .select('state, leader')
        .order('state', { ascending: true })
        .order('leader', { ascending: true });
      if (fetchError) throw fetchError;
      setStateLeaders((data || []) as StateLeaderOption[]);
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Failed to fetch state leaders'));
    }
  };

  useEffect(() => {
    if (hasAccess) {
      fetchShares();
      fetchStateLeaders();
    }
  }, [hasAccess]);

  const leadersForState = (state: string) =>
    stateLeaders.filter((sl) => (sl.state || '').toUpperCase().trim() === (state || '').toUpperCase().trim()).map((sl) => sl.leader);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setIsSubmitting(true);
    try {
      const ownerState = (formState.owner_state || '').toUpperCase().trim();
      const sharedWithState = (formState.shared_with_state || '').toUpperCase().trim();
      if (!ownerState || !formState.owner_leader?.trim() || !sharedWithState || !formState.shared_with_leader?.trim()) {
        throw new Error('Please select owner and shared-with state and leader');
      }
      const { error: insertError } = await supabase.from('leader_shares').insert([
        {
          owner_state: ownerState,
          owner_leader: formState.owner_leader.trim(),
          shared_with_state: sharedWithState,
          shared_with_leader: formState.shared_with_leader.trim(),
        },
      ]);
      if (insertError) {
        if (insertError.code === '23505') {
          throw new Error('This sharing relationship already exists');
        }
        throw insertError;
      }
      setSuccess('Leader sharing added. All campaigns by the owner are now visible to the shared-with leader.');
      setFormState({ owner_state: '', owner_leader: '', shared_with_state: '', shared_with_leader: '' });
      await fetchShares();
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Failed to add leader share'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Remove this sharing? The shared-with leader will no longer see the owner\'s campaigns.')) return;
    try {
      const { error: deleteError } = await supabase.from('leader_shares').delete().eq('id', id);
      if (deleteError) throw deleteError;
      setSuccess('Sharing removed');
      await fetchShares();
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Failed to remove sharing'));
    }
  };

  if (isUserLoading) {
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
            <h2 className="text-lg font-semibold text-red-800 dark:text-red-200">Access Denied</h2>
            <p className="mt-1 text-sm text-red-600 dark:text-red-300">{error || 'You do not have permission to access this page.'}</p>
            <button onClick={() => router.push('/admin')} className="mt-4 rounded-md bg-red-600 px-4 py-2 text-base font-bold text-white hover:bg-red-700 border-2 border-gray-800 dark:border-gray-600">
              Go Back
            </button>
          </div>
        </div>
      </MobileLayout>
    );
  }

  return (
    <MobileLayout>
      <div className="p-4">
        <div className="mb-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Leader sharing</h1>
              <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                Define who can see whose campaigns. One row: owner’s campaigns are visible to shared-with leader. For mutual sharing, add two rows (A→B and B→A).
              </p>
            </div>
            <button onClick={() => router.push('/admin')} className="rounded-md bg-gray-200 px-3 py-2 text-base font-bold text-gray-700 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600 border-2 border-gray-800 dark:border-gray-600">
              Back
            </button>
          </div>
        </div>

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

        <div className="mb-6 rounded-lg border border-gray-200 bg-blue-50 p-4 shadow-sm dark:border-gray-700 dark:bg-blue-900/20">
          <h2 className="mb-4 text-lg font-semibold text-gray-900 dark:text-gray-100">Add sharing (owner → shared with)</h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Owner (whose campaigns are shared)</label>
              <div className="mt-1 flex gap-2">
                <select
                  required
                  value={formState.owner_state}
                  onChange={(e) => setFormState({ ...formState, owner_state: e.target.value, owner_leader: '' })}
                  className="block w-24 rounded-md border-2 border-gray-400 bg-white px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500 dark:border-gray-500 dark:bg-gray-900 dark:text-white"
                >
                  <option value="">State</option>
                  {AUSTRALIAN_STATES.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
                <select
                  required
                  value={formState.owner_leader}
                  onChange={(e) => setFormState({ ...formState, owner_leader: e.target.value })}
                  className="flex-1 rounded-md border-2 border-gray-400 bg-white px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500 dark:border-gray-500 dark:bg-gray-900 dark:text-white"
                >
                  <option value="">Leader</option>
                  {leadersForState(formState.owner_state).map((l) => (
                    <option key={l} value={l}>{l}</option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Shared with (who can see those campaigns)</label>
              <div className="mt-1 flex gap-2">
                <select
                  required
                  value={formState.shared_with_state}
                  onChange={(e) => setFormState({ ...formState, shared_with_state: e.target.value, shared_with_leader: '' })}
                  className="block w-24 rounded-md border-2 border-gray-400 bg-white px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500 dark:border-gray-500 dark:bg-gray-900 dark:text-white"
                >
                  <option value="">State</option>
                  {AUSTRALIAN_STATES.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
                <select
                  required
                  value={formState.shared_with_leader}
                  onChange={(e) => setFormState({ ...formState, shared_with_leader: e.target.value })}
                  className="flex-1 rounded-md border-2 border-gray-400 bg-white px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500 dark:border-gray-500 dark:bg-gray-900 dark:text-white"
                >
                  <option value="">Leader</option>
                  {leadersForState(formState.shared_with_state).map((l) => (
                    <option key={l} value={l}>{l}</option>
                  ))}
                </select>
              </div>
            </div>
            <button
              type="submit"
              disabled={isSubmitting}
              className="rounded-md bg-blue-600 px-4 py-2 text-base font-bold text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed border-2 border-gray-800 dark:border-gray-600"
            >
              {isSubmitting ? 'Adding...' : 'Add sharing'}
            </button>
          </form>
        </div>

        <div className="rounded-lg border-2 border-gray-800 dark:border-gray-600 bg-white shadow-sm dark:bg-gray-800">
          <div className="p-4">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Current sharing ({shares.length})</h2>
          </div>
          <div className="divide-y divide-gray-200 dark:divide-gray-700">
            {shares.length === 0 ? (
              <div className="p-4 text-center text-sm text-gray-500 dark:text-gray-400">No sharing defined. Add a row so one leader can see another leader’s campaigns.</div>
            ) : (
              shares.map((s) => {
                const ownerColor = getStateColor(s.owner_state);
                const sharedColor = getStateColor(s.shared_with_state);
                return (
                  <div key={s.id} className="p-4 flex items-center justify-between flex-wrap gap-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`font-medium ${ownerColor.text}`}>{s.owner_leader}</span>
                      <span className={`text-sm ${ownerColor.text} opacity-75`}>({s.owner_state})</span>
                      <span className="text-gray-500 dark:text-gray-400">→</span>
                      <span className={`font-medium ${sharedColor.text}`}>{s.shared_with_leader}</span>
                      <span className={`text-sm ${sharedColor.text} opacity-75`}>({s.shared_with_state})</span>
                    </div>
                    <button
                      onClick={() => handleDelete(s.id)}
                      className="rounded-md bg-red-100 px-3 py-1 text-sm font-medium text-red-700 hover:bg-red-200 dark:bg-red-900/30 dark:text-red-300 dark:hover:bg-red-900/50"
                    >
                      Remove
                    </button>
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
