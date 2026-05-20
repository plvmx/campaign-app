'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import MobileLayout from '@/components/MobileLayout';
import { useUser } from '@/contexts/UserContext';
import { supabase } from '@/lib/supabaseClient';
import { getErrorMessage } from '@/lib/errorUtils';

interface CampaignCategory {
  id: string;
  code: string;
  name: string;
  created_at: string;
}

export default function CampaignCategoriesPage() {
  const router = useRouter();
  const { user, isAdmin, isLoading: isUserLoading } = useUser();
  const [hasAccess, setHasAccess] = useState(false);
  const [categories, setCategories] = useState<CampaignCategory[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Form state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formState, setFormState] = useState({ code: '', name: '' });

  useEffect(() => {
    if (isUserLoading) return;
    if (!user) { router.push('/login'); return; }
    if (!isAdmin) {
      setError('You do not have permission to access this page');
      return;
    }
    setHasAccess(true);
  }, [isUserLoading, user, isAdmin, router]);

  const fetchCategories = useCallback(async () => {
    try {
      const { data, error: fetchError } = await supabase
        .from('campaign_categories')
        .select('*')
        .order('code', { ascending: true });

      if (fetchError) throw fetchError;
      setCategories(data || []);
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Failed to fetch campaign categories'));
    }
  }, []);

  useEffect(() => {
    if (hasAccess) fetchCategories();
  }, [hasAccess, fetchCategories]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setIsSubmitting(true);

    const code = formState.code.trim().toUpperCase();
    const name = formState.name.trim();

    try {
      if (editingId) {
        const { error: updateError } = await supabase
          .from('campaign_categories')
          .update({ code, name })
          .eq('id', editingId);

        if (updateError) throw updateError;
        setSuccess('Category updated successfully');
      } else {
        const { error: insertError } = await supabase
          .from('campaign_categories')
          .insert([{ code, name }]);

        if (insertError) {
          if (insertError.code === '23505') {
            throw new Error(`Category code '${code}' already exists`);
          }
          throw insertError;
        }
        setSuccess('Category created successfully');
      }

      setFormState({ code: '', name: '' });
      setEditingId(null);
      await fetchCategories();
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Failed to save category'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleEdit = (item: CampaignCategory) => {
    setEditingId(item.id);
    setFormState({ code: item.code, name: item.name });
    setError(null);
    setSuccess(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleDelete = async (id: string, code: string) => {
    if (!confirm(`Are you sure you want to delete the '${code}' category? This will fail if any campaigns are using it.`)) {
      return;
    }

    try {
      const { error: deleteError } = await supabase
        .from('campaign_categories')
        .delete()
        .eq('id', id);

      if (deleteError) throw deleteError;
      setSuccess('Category deleted successfully');
      await fetchCategories();
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Failed to delete category'));
    }
  };

  const handleCancel = () => {
    setEditingId(null);
    setFormState({ code: '', name: '' });
    setError(null);
    setSuccess(null);
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
      <div className="p-4">
        <div className="mb-6">
          <button
            onClick={() => router.push('/admin')}
            className="mb-4 text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400"
          >
            ← Back to Admin Panel
          </button>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            Campaign Categories
          </h1>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            Manage the campaign category list. Categories are used in forms and slide generation.
          </p>
        </div>

        {/* Success/Error Messages */}
        {success && (
          <div className="mb-4 rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800 dark:border-green-800 dark:bg-green-900/20 dark:text-green-200">
            {success}
          </div>
        )}
        {error && (
          <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-900/20 dark:text-red-200">
            {error}
          </div>
        )}

        {/* Add/Edit Form */}
        <div className="mb-6 rounded-lg border border-gray-200 bg-blue-50 p-4 shadow-sm dark:border-gray-700 dark:bg-blue-900/20">
          <h2 className="mb-4 text-lg font-semibold text-gray-900 dark:text-gray-100">
            {editingId ? 'Edit Category' : 'Add New Category'}
          </h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="code" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                Code
              </label>
              <input
                id="code"
                type="text"
                required
                value={formState.code}
                onChange={(e) => setFormState({ ...formState, code: e.target.value.toUpperCase() })}
                className="mt-1 block w-full rounded-md border-2 border-gray-400 bg-white px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500 dark:border-gray-500 dark:bg-gray-900 dark:text-white"
                placeholder="e.g. TWOL"
                maxLength={10}
              />
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                Short uppercase code used in campaign data (e.g. TWOL, BOTJ, TLT)
              </p>
            </div>
            <div>
              <label htmlFor="name" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                Name
              </label>
              <input
                id="name"
                type="text"
                required
                value={formState.name}
                onChange={(e) => setFormState({ ...formState, name: e.target.value })}
                className="mt-1 block w-full rounded-md border-2 border-gray-400 bg-white px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500 dark:border-gray-500 dark:bg-gray-900 dark:text-white"
                placeholder="e.g. Two Weekly"
              />
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                Full descriptive name shown in dropdowns
              </p>
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

        {/* Category List */}
        <div className="rounded-lg border-2 border-gray-800 bg-white shadow-sm dark:border-gray-600 dark:bg-gray-800">
          <div className="p-4">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              Categories ({categories.length})
            </h2>
          </div>
          <div className="divide-y divide-gray-200 dark:divide-gray-700">
            {categories.length === 0 ? (
              <div className="p-4 text-center text-sm text-gray-500 dark:text-gray-400">
                No categories found
              </div>
            ) : (
              categories.map((item) => (
                <div key={item.id} className="p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-bold text-gray-900 dark:text-gray-100">
                        {item.code}
                      </div>
                      <div className="text-sm text-gray-600 dark:text-gray-400">
                        {item.name}
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
                        onClick={() => handleDelete(item.id, item.code)}
                        className="rounded-md bg-red-100 px-3 py-1 text-base font-bold text-red-700 hover:bg-red-200 dark:bg-red-900/30 dark:text-red-300 dark:hover:bg-red-900/50 border-2 border-gray-800 dark:border-gray-600"
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
