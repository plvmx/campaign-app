import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * The CAS User Guide PDF that leaders open from the "OPEN GUIDE" button.
 *
 * Kept in a **private** Supabase Storage bucket (the guide carries
 * screenshots and support phone numbers, so it isn't put on a public URL).
 * Nothing in the browser reads the bucket directly: leaders get a
 * short-lived signed URL from GET /api/leader/user-guide, and an admin
 * uploads through a one-time signed upload URL from
 * POST /api/admin/user-guide/upload-url — direct to Storage, so a large PDF
 * never hits Vercel's request-body limit.
 *
 * Each upload gets a new timestamped name and the newest file is the current
 * guide, so a replaced guide is never served from a stale CDN cache. Before
 * each new upload everything but the current guide is deleted, so at most
 * the current and previous versions exist at any time.
 *
 * Every function takes an injected client — always `supabaseAdmin` in
 * practice (the bucket has no RLS policies, so only the service role can
 * reach it).
 */

export const USER_GUIDE_BUCKET = 'user-guide';
export const USER_GUIDE_MAX_BYTES = 20 * 1024 * 1024;
/** Long enough that a guide page left open for an afternoon still opens. */
export const USER_GUIDE_URL_TTL_SECONDS = 4 * 60 * 60;

const GUIDE_NAME_PATTERN = /^guide-(\d+)\.pdf$/;

export interface UserGuideFile {
  path: string;
  uploadedAt: string;
}

export interface UserGuideView {
  url: string;
  uploadedAt: string;
}

/** Name for a newly uploaded guide; the timestamp both orders versions and busts caches. */
export function makeUserGuidePath(now: Date = new Date()): string {
  return `guide-${now.getTime()}.pdf`;
}

/** Newest first. Ignores anything in the bucket that isn't one of our guide files. */
async function listGuides(client: SupabaseClient): Promise<UserGuideFile[]> {
  const { data, error } = await client.storage.from(USER_GUIDE_BUCKET).list('', {
    limit: 100,
    sortBy: { column: 'name', order: 'desc' },
  });
  if (error) {
    // A bucket that hasn't been created yet just means no guide has been uploaded.
    if (/not found/i.test(error.message ?? '')) return [];
    throw new Error(`Could not list user guides: ${error.message ?? 'unknown error'}`);
  }
  return (data ?? [])
    .map((f) => GUIDE_NAME_PATTERN.exec(f.name))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => ({ path: m[0], uploadedMs: Number(m[1]) }))
    .sort((a, b) => b.uploadedMs - a.uploadedMs)
    .map(({ path, uploadedMs }) => ({ path, uploadedAt: new Date(uploadedMs).toISOString() }));
}

export async function getCurrentUserGuide(client: SupabaseClient): Promise<UserGuideFile | null> {
  return (await listGuides(client))[0] ?? null;
}

/** A signed URL for the current guide, or null when none has been uploaded yet. */
export async function getUserGuideView(client: SupabaseClient): Promise<UserGuideView | null> {
  const current = await getCurrentUserGuide(client);
  if (!current) return null;

  const { data, error } = await client.storage
    .from(USER_GUIDE_BUCKET)
    .createSignedUrl(current.path, USER_GUIDE_URL_TTL_SECONDS);
  if (error || !data?.signedUrl) {
    throw new Error(`Could not create a link to the user guide: ${error?.message ?? 'unknown error'}`);
  }
  return { url: data.signedUrl, uploadedAt: current.uploadedAt };
}

async function ensureBucket(client: SupabaseClient): Promise<void> {
  const { data } = await client.storage.getBucket(USER_GUIDE_BUCKET);
  if (data) return;
  const { error } = await client.storage.createBucket(USER_GUIDE_BUCKET, {
    public: false,
    fileSizeLimit: USER_GUIDE_MAX_BYTES,
    allowedMimeTypes: ['application/pdf'],
  });
  if (error && !/already exists/i.test(error.message ?? '')) {
    throw new Error(`Could not create the user guide bucket: ${error.message ?? 'unknown error'}`);
  }
}

/**
 * Prepares an admin upload: creates the bucket on first use, deletes every
 * guide except the current one, and returns a one-time signed upload target
 * for the new file. The new file becomes the current guide as soon as its
 * upload finishes.
 */
export async function createUserGuideUploadTarget(
  client: SupabaseClient,
  now: Date = new Date(),
): Promise<{ path: string; token: string }> {
  await ensureBucket(client);

  const stale = (await listGuides(client)).slice(1).map((g) => g.path);
  if (stale.length > 0) {
    const { error } = await client.storage.from(USER_GUIDE_BUCKET).remove(stale);
    // Leftovers only cost storage; never block the new upload over them.
    if (error) console.error('[userGuide] could not remove old guides:', error.message);
  }

  const path = makeUserGuidePath(now);
  const { data, error } = await client.storage.from(USER_GUIDE_BUCKET).createSignedUploadUrl(path);
  if (error || !data?.token) {
    throw new Error(`Could not prepare the upload: ${error?.message ?? 'unknown error'}`);
  }
  return { path, token: data.token };
}

/** "15 October 2026" — how the guide's upload date is shown to people. */
export function formatGuideDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' });
}

/**
 * Browser-side check before uploading — the bucket also refuses non-PDFs
 * and oversized files, but this gives a plain-English message first.
 * `header` is the file's first bytes (a real PDF starts with "%PDF-").
 */
export function validateUserGuideFile(
  file: { name: string; size: number; type: string },
  header: Uint8Array,
): string | null {
  const looksLikePdf = new TextDecoder().decode(header.slice(0, 5)) === '%PDF-';
  if (!looksLikePdf || (file.type && file.type !== 'application/pdf')) {
    return 'Please choose a PDF file.';
  }
  if (file.size > USER_GUIDE_MAX_BYTES) {
    return `That file is too large (${(file.size / 1024 / 1024).toFixed(1)} MB). The limit is ${USER_GUIDE_MAX_BYTES / 1024 / 1024} MB.`;
  }
  if (file.size === 0) return 'That file is empty.';
  return null;
}
