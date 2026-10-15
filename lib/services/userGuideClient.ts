import { supabase } from '@/lib/supabaseClient';
import { USER_GUIDE_BUCKET, type UserGuideView } from '@/lib/services/userGuideService';

async function authHeader(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not signed in');
  return { Authorization: `Bearer ${session.access_token}` };
}

/** Browser-side call to GET /api/leader/user-guide. Null when no guide has been uploaded yet. */
export async function fetchUserGuide(): Promise<UserGuideView | null> {
  const res = await fetch('/api/leader/user-guide', { headers: await authHeader() });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((json as { error?: string }).error || 'The guide could not be loaded');
  const { url, uploadedAt } = json as { url: string | null; uploadedAt?: string };
  return url && uploadedAt ? { url, uploadedAt } : null;
}

/**
 * Admin upload of a new guide: gets a one-time signed upload target from
 * POST /api/admin/user-guide/upload-url, then sends the file straight to
 * Storage. Throws with a readable message on failure.
 */
export async function uploadUserGuide(file: File): Promise<void> {
  const res = await fetch('/api/admin/user-guide/upload-url', { method: 'POST', headers: await authHeader() });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((json as { error?: string }).error || 'Could not prepare the upload');
  const { path, token } = json as { path: string; token: string };

  const { error } = await supabase.storage
    .from(USER_GUIDE_BUCKET)
    .uploadToSignedUrl(path, token, file, { contentType: 'application/pdf' });
  if (error) throw new Error(`Upload failed: ${error.message}`);
}
