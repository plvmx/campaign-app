'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import MobileLayout from '@/components/MobileLayout';
import LoadingSpinner from '@/components/LoadingSpinner';
import { useUser } from '@/contexts/UserContext';
import { PUBLIC_LINKS, publicLinkTitleSettingKey, publicLinkDescriptionSettingKey } from '@/lib/publicLinks';
import { getSetting, setPublicLinkTitle, setPublicLinkDescription } from '@/lib/appSettings';
import { getErrorMessage } from '@/lib/errorUtils';

interface Override {
  title: string | null;
  description: string | null;
}

export default function PublicLinksPage() {
  const router = useRouter();
  const { user, isAdmin, isLoading: isUserLoading } = useUser();
  const [hasAccess, setHasAccess] = useState(false);
  const [accessError, setAccessError] = useState<string | null>(null);
  const [copiedPath, setCopiedPath] = useState<string | null>(null);
  const [copyError, setCopyError] = useState<string | null>(null);
  // Starts null so the server-rendered and first client-rendered markup match
  // (both show the bare path); filled in after mount to avoid a hydration
  // mismatch from reading window.location during render.
  const [origin, setOrigin] = useState<string | null>(null);

  // slug -> saved override (null field = falls back to the lib/publicLinks.ts default)
  const [overrides, setOverrides] = useState<Record<string, Override>>({});
  const [isLoadingOverrides, setIsLoadingOverrides] = useState(true);

  // Inline edit state — only one link editable at a time.
  const [editingSlug, setEditingSlug] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [savedSlug, setSavedSlug] = useState<string | null>(null);

  useEffect(() => {
    Promise.resolve().then(() => setOrigin(window.location.origin));
  }, []);

  useEffect(() => {
    if (isUserLoading) return;
    if (!user) { router.push('/login'); return; }
    Promise.resolve().then(() => {
      if (!isAdmin) {
        setAccessError('You do not have permission to access this page');
        return;
      }
      setHasAccess(true);
    });
  }, [isUserLoading, user, isAdmin, router]);

  useEffect(() => {
    if (!hasAccess) return;
    let cancelled = false;

    Promise.all(
      PUBLIC_LINKS.map(async (link) => {
        const [title, description] = await Promise.all([
          getSetting(publicLinkTitleSettingKey(link.slug)),
          getSetting(publicLinkDescriptionSettingKey(link.slug)),
        ]);
        return [link.slug, { title, description }] as const;
      })
    ).then((entries) => {
      if (cancelled) return;
      setOverrides(Object.fromEntries(entries));
    }).finally(() => {
      if (!cancelled) setIsLoadingOverrides(false);
    });

    return () => { cancelled = true; };
  }, [hasAccess]);

  const effectiveTitle = (slug: string, fallback: string) => overrides[slug]?.title || fallback;
  const effectiveDescription = (slug: string, fallback: string) => overrides[slug]?.description || fallback;

  const handleCopy = async (path: string, url: string) => {
    setCopyError(null);
    try {
      await navigator.clipboard.writeText(url);
      setCopiedPath(path);
      setTimeout(() => setCopiedPath((current) => (current === path ? null : current)), 2000);
    } catch {
      setCopyError(`Could not copy link — copy it manually: ${url}`);
    }
  };

  const startEdit = (slug: string, fallbackTitle: string, fallbackDescription: string) => {
    setEditingSlug(slug);
    setEditTitle(effectiveTitle(slug, fallbackTitle));
    setEditDescription(effectiveDescription(slug, fallbackDescription));
    setEditError(null);
  };

  const cancelEdit = () => {
    setEditingSlug(null);
    setEditError(null);
  };

  const saveEdit = async (slug: string) => {
    setIsSaving(true);
    setEditError(null);
    try {
      await Promise.all([
        setPublicLinkTitle(slug, editTitle.trim()),
        setPublicLinkDescription(slug, editDescription.trim()),
      ]);
      setOverrides((prev) => ({
        ...prev,
        [slug]: { title: editTitle.trim() || null, description: editDescription.trim() || null },
      }));
      setEditingSlug(null);
      setSavedSlug(slug);
      setTimeout(() => setSavedSlug((current) => (current === slug ? null : current)), 2000);
    } catch (err) {
      setEditError(getErrorMessage(err, 'Failed to save'));
    } finally {
      setIsSaving(false);
    }
  };

  const resetToDefault = async (slug: string) => {
    setIsSaving(true);
    setEditError(null);
    try {
      await Promise.all([setPublicLinkTitle(slug, ''), setPublicLinkDescription(slug, '')]);
      setOverrides((prev) => ({ ...prev, [slug]: { title: null, description: null } }));
      setEditingSlug(null);
    } catch (err) {
      setEditError(getErrorMessage(err, 'Failed to reset'));
    } finally {
      setIsSaving(false);
    }
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
            <h2 className="text-lg font-semibold text-red-800 dark:text-red-200">Access Denied</h2>
            <p className="mt-1 text-sm text-red-600 dark:text-red-300">
              {accessError || 'You do not have permission to access this page.'}
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
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Public Links</h1>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
              No-login links — anyone with the URL can open them. Copy a link below to share it, or edit its title/description — that text is also what shows in link previews (WhatsApp, iMessage, etc.).
            </p>
          </div>
          <button
            onClick={() => router.push('/admin')}
            className="rounded-md bg-gray-200 px-3 py-2 text-base font-bold text-gray-700 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600 border-2 border-gray-800 dark:border-gray-600"
          >
            Back
          </button>
        </div>

        {copyError && (
          <div className="mb-4 rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-800 dark:bg-red-900/20 dark:border-red-800 dark:text-red-200">
            {copyError}
          </div>
        )}

        <div className="space-y-4">
          {PUBLIC_LINKS.map((link) => {
            const url = origin ? `${origin}${link.path}` : link.path;
            const isEditing = editingSlug === link.slug;
            const hasOverride = !!(overrides[link.slug]?.title || overrides[link.slug]?.description);

            return (
              <div
                key={link.path}
                className="rounded-lg border-2 border-gray-800 dark:border-gray-600 bg-white p-4 shadow-sm dark:bg-gray-800"
              >
                {isEditing ? (
                  <div className="space-y-3">
                    <div>
                      <label className="block text-xs font-medium text-gray-700 dark:text-gray-300">Title</label>
                      <input
                        type="text"
                        value={editTitle}
                        onChange={(e) => setEditTitle(e.target.value)}
                        maxLength={200}
                        className="mt-1 w-full rounded-md border-2 border-gray-400 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-blue-500 dark:border-gray-500 dark:bg-gray-900 dark:text-white"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-700 dark:text-gray-300">Description</label>
                      <textarea
                        value={editDescription}
                        onChange={(e) => setEditDescription(e.target.value)}
                        maxLength={500}
                        rows={2}
                        className="mt-1 w-full rounded-md border-2 border-gray-400 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-blue-500 dark:border-gray-500 dark:bg-gray-900 dark:text-white"
                      />
                    </div>
                    {editError && (
                      <p className="text-sm text-red-600 dark:text-red-400">{editError}</p>
                    )}
                    <div className="flex flex-wrap gap-2">
                      <button
                        onClick={() => saveEdit(link.slug)}
                        disabled={isSaving || !editTitle.trim() || !editDescription.trim()}
                        className="rounded-md bg-blue-600 px-3 py-2 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed border-2 border-gray-800 dark:border-gray-600"
                      >
                        {isSaving ? 'Saving…' : 'Save'}
                      </button>
                      <button
                        onClick={cancelEdit}
                        disabled={isSaving}
                        className="rounded-md bg-gray-200 px-3 py-2 text-sm font-bold text-gray-700 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600 border-2 border-gray-800 dark:border-gray-600"
                      >
                        Cancel
                      </button>
                      {hasOverride && (
                        <button
                          onClick={() => resetToDefault(link.slug)}
                          disabled={isSaving}
                          className="rounded-md bg-red-100 px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-200 dark:bg-red-900/30 dark:text-red-300 dark:hover:bg-red-900/50"
                        >
                          Reset to default
                        </button>
                      )}
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                          {isLoadingOverrides ? link.title : effectiveTitle(link.slug, link.title)}
                        </h2>
                        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                          {isLoadingOverrides ? link.description : effectiveDescription(link.slug, link.description)}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        {hasOverride && !isLoadingOverrides && (
                          <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
                            Edited
                          </span>
                        )}
                        <button
                          onClick={() => startEdit(link.slug, link.title, link.description)}
                          disabled={isLoadingOverrides}
                          className="rounded-md bg-gray-200 px-3 py-1.5 text-xs font-bold text-gray-700 hover:bg-gray-300 disabled:opacity-50 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600 border-2 border-gray-800 dark:border-gray-600"
                        >
                          {savedSlug === link.slug ? 'Saved!' : 'Edit text'}
                        </button>
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <code className="flex-1 min-w-[12rem] break-all rounded-md border border-gray-300 bg-gray-50 px-3 py-2 text-xs text-gray-800 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-200">
                        {url}
                      </code>
                      <button
                        onClick={() => handleCopy(link.path, url)}
                        className="rounded-md bg-blue-600 px-3 py-2 text-sm font-bold text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 border-2 border-gray-800 dark:border-gray-600"
                      >
                        {copiedPath === link.path ? 'Copied!' : 'Copy Link'}
                      </button>
                      <a
                        href={link.path}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="rounded-md bg-gray-200 px-3 py-2 text-sm font-bold text-gray-700 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600 border-2 border-gray-800 dark:border-gray-600"
                      >
                        Open
                      </a>
                    </div>
                  </>
                )}
              </div>
            );
          })}

          {PUBLIC_LINKS.length === 0 && (
            <div className="rounded-lg border-2 border-gray-800 dark:border-gray-600 bg-white p-4 text-center text-sm text-gray-500 shadow-sm dark:bg-gray-800 dark:text-gray-400">
              No public links yet.
            </div>
          )}
        </div>
      </div>
    </MobileLayout>
  );
}
