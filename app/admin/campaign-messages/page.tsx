'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import MobileLayout from '@/components/MobileLayout';
import { getCurrentUser } from '@/lib/auth';
import { hasPermission, Permission } from '@/lib/permissions';
import { supabase } from '@/lib/supabaseClient';

interface CampaignMessage {
  date: string;
  message: string;
  created_at: string;
  updated_at: string;
}

export default function CampaignMessagesPage() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(true);
  const [hasAccess, setHasAccess] = useState(false);
  const [messages, setMessages] = useState<CampaignMessage[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  
  // Form state
  const [editingDate, setEditingDate] = useState<string | null>(null);
  const [formState, setFormState] = useState({ date: '', message: '' });

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
        await fetchMessages();
      } catch (err: any) {
        setError(err.message || 'Access denied');
      } finally {
        setIsLoading(false);
      }
    }
    checkAuthAndPermissions();
  }, [router]);

  const fetchMessages = async () => {
    try {
      const { data, error } = await supabase
        .from('campaign_messages')
        .select('*')
        .order('date', { ascending: false });
      
      if (error) throw error;
      setMessages(data || []);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch campaign messages');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setIsSubmitting(true);

    try {
      if (editingDate) {
        // Update existing record
        const { error } = await supabase
          .from('campaign_messages')
          .update({ 
            message: formState.message,
            updated_at: new Date().toISOString()
          })
          .eq('date', editingDate);

        if (error) throw error;
        setSuccess('Campaign message updated successfully');
      } else {
        // Create new record
        const { error } = await supabase
          .from('campaign_messages')
          .insert([{ 
            date: formState.date, 
            message: formState.message
          }]);

        if (error) {
          if (error.code === '23505') {
            throw new Error('A message already exists for this date');
          }
          throw error;
        }
        setSuccess('Campaign message created successfully');
      }

      // Reset form
      setFormState({ date: '', message: '' });
      setEditingDate(null);
      await fetchMessages();
    } catch (err: any) {
      setError(err.message || 'Failed to save campaign message');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleEdit = (item: CampaignMessage) => {
    setEditingDate(item.date);
    setFormState({ 
      date: item.date, 
      message: item.message
    });
    setError(null);
    setSuccess(null);
    // Scroll to form
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleDelete = async (date: string) => {
    if (!confirm('Are you sure you want to delete this campaign message?')) {
      return;
    }

    try {
      const { error } = await supabase
        .from('campaign_messages')
        .delete()
        .eq('date', date);
      
      if (error) throw error;
      setSuccess('Campaign message deleted successfully');
      await fetchMessages();
    } catch (err: any) {
      setError(err.message || 'Failed to delete campaign message');
    }
  };

  const handleCancel = () => {
    setEditingDate(null);
    setFormState({ date: '', message: '' });
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
              className="mt-4 rounded-md bg-red-600 px-4 py-2 text-base font-bold text-white hover:bg-red-700 border-2 border-gray-800 dark:border-gray-600"
            >
              Go Back
            </button>
          </div>
        </div>
      </MobileLayout>
    );
  }

  return (
    <MobileLayout>
      <div className="p-4 max-w-full overflow-x-hidden">
        <div className="mb-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-gray-100 break-words">
                Campaign Messages
              </h1>
              <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                Add special messages to display on campaign slides for specific dates
              </p>
            </div>
            <button
              onClick={() => router.push('/admin')}
              className="rounded-md bg-gray-200 px-3 py-2 text-base font-bold text-gray-700 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600 whitespace-nowrap border-2 border-gray-800 dark:border-gray-600"
            >
              Back
            </button>
          </div>
        </div>

        {/* Success/Error Messages */}
        {success && (
          <div className="mb-4 rounded-md bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-800 dark:bg-green-900/20 dark:border-green-800 dark:text-green-200 break-words">
            {success}
          </div>
        )}
        {error && (
          <div className="mb-4 rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-800 dark:bg-red-900/20 dark:border-red-800 dark:text-red-200 break-words">
            {error}
          </div>
        )}

        {/* Add/Edit Form */}
        <div className="mb-6 rounded-lg border border-gray-200 bg-blue-50 p-4 shadow-sm dark:border-gray-700 dark:bg-blue-900/20 w-full overflow-hidden">
          <h2 className="mb-4 text-lg font-semibold text-gray-900 dark:text-gray-100">
            {editingDate ? 'Edit Campaign Message' : 'Add New Campaign Message'}
          </h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="date" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                Date
              </label>
              <input
                id="date"
                type="date"
                required
                value={formState.date}
                onChange={(e) => setFormState({ ...formState, date: e.target.value })}
                disabled={!!editingDate}
                className="mt-1 block w-full rounded-md border-2 border-gray-400 bg-white px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500 dark:border-gray-500 dark:bg-gray-900 dark:text-white disabled:opacity-50 disabled:cursor-not-allowed"
              />
            </div>
            <div>
              <label htmlFor="message" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                Message
              </label>
              <textarea
                id="message"
                required
                rows={3}
                value={formState.message}
                onChange={(e) => setFormState({ ...formState, message: e.target.value })}
                className="mt-1 block w-full rounded-md border-2 border-gray-400 bg-white px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500 dark:border-gray-500 dark:bg-gray-900 dark:text-white"
                placeholder="Enter message to display on slides"
              />
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                This message will appear as a banner after the campaigns for the selected date.
              </p>
            </div>
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={isSubmitting}
                className="flex-1 rounded-md bg-blue-600 px-4 py-2 text-base font-bold text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed border-2 border-gray-800 dark:border-gray-600"
              >
                {isSubmitting ? 'Saving...' : editingDate ? 'Update' : 'Add'}
              </button>
              {editingDate && (
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

        {/* List of Campaign Messages */}
        <div className="rounded-lg border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800 w-full overflow-hidden">
          <div className="p-4">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              Campaign Messages ({messages.length})
            </h2>
          </div>
          <div className="divide-y divide-gray-200 dark:divide-gray-700">
            {messages.length === 0 ? (
              <div className="p-4 text-center text-sm text-gray-500 dark:text-gray-400">
                No campaign messages found
              </div>
            ) : (
              messages.map((item) => (
                <div key={item.date} className="p-4 hover:bg-gray-50 dark:hover:bg-gray-700/50">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-gray-900 dark:text-gray-100">
                        {new Date(item.date).toLocaleDateString('en-AU', { 
                          weekday: 'long', 
                          day: 'numeric', 
                          month: 'long', 
                          year: 'numeric' 
                        })}
                      </div>
                      <div className="mt-1 text-sm text-gray-600 dark:text-gray-400 break-words">
                        {item.message}
                      </div>
                    </div>
                    <div className="flex flex-col sm:flex-row gap-2 flex-shrink-0">
                      <button
                        onClick={() => handleEdit(item)}
                        className="rounded-md bg-blue-100 px-3 py-1 text-base font-bold text-blue-700 hover:bg-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:hover:bg-blue-900/50 whitespace-nowrap border-2 border-gray-800 dark:border-gray-600"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleDelete(item.date)}
                        className="rounded-md bg-red-100 px-3 py-1 text-base font-bold text-red-700 hover:bg-red-200 dark:bg-red-900/30 dark:text-red-300 dark:hover:bg-red-900/50 whitespace-nowrap border-2 border-gray-800 dark:border-gray-600"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </MobileLayout>
  );
}
