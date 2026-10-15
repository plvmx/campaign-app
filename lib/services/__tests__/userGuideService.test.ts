import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  USER_GUIDE_BUCKET,
  USER_GUIDE_MAX_BYTES,
  createUserGuideUploadTarget,
  formatGuideDate,
  getCurrentUserGuide,
  getUserGuideView,
  makeUserGuidePath,
  validateUserGuideFile,
} from '../userGuideService';

// Storage isn't a query builder, so supabaseMock.ts doesn't cover it — a
// small fake of the bucket API calls this module makes.
function makeStorageClient(opts: {
  files?: string[];
  listError?: { message: string };
  bucketExists?: boolean;
} = {}) {
  const bucket = {
    list: vi.fn().mockResolvedValue(
      opts.listError ? { data: null, error: opts.listError } : { data: (opts.files ?? []).map((name) => ({ name })), error: null },
    ),
    createSignedUrl: vi.fn((path: string) => Promise.resolve({ data: { signedUrl: `https://signed/${path}` }, error: null })),
    createSignedUploadUrl: vi.fn((path: string) => Promise.resolve({ data: { path, token: 'upload-token', signedUrl: 'x' }, error: null })),
    remove: vi.fn().mockResolvedValue({ data: [], error: null }),
  };
  const storage = {
    from: vi.fn(() => bucket),
    getBucket: vi.fn().mockResolvedValue(opts.bucketExists === false ? { data: null, error: { message: 'Bucket not found' } } : { data: { id: USER_GUIDE_BUCKET }, error: null }),
    createBucket: vi.fn().mockResolvedValue({ data: { name: USER_GUIDE_BUCKET }, error: null }),
  };
  return { client: { storage } as unknown as SupabaseClient, storage, bucket };
}

const T1 = Date.UTC(2026, 8, 1);   // 1 Sep 2026
const T2 = Date.UTC(2026, 9, 15);  // 15 Oct 2026

describe('makeUserGuidePath', () => {
  it('names each upload by its timestamp', () => {
    expect(makeUserGuidePath(new Date(T2))).toBe(`guide-${T2}.pdf`);
  });
});

describe('getCurrentUserGuide', () => {
  it('returns the newest guide, ignoring other files', async () => {
    const { client } = makeStorageClient({ files: [`guide-${T1}.pdf`, 'notes.txt', `guide-${T2}.pdf`, '.emptyFolderPlaceholder'] });
    expect(await getCurrentUserGuide(client)).toEqual({ path: `guide-${T2}.pdf`, uploadedAt: new Date(T2).toISOString() });
  });

  it('orders by timestamp, not text (a shorter number is older)', async () => {
    const { client } = makeStorageClient({ files: ['guide-999.pdf', 'guide-1000.pdf'] });
    expect((await getCurrentUserGuide(client))?.path).toBe('guide-1000.pdf');
  });

  it('returns null when nothing has been uploaded', async () => {
    expect(await getCurrentUserGuide(makeStorageClient().client)).toBeNull();
  });

  it('returns null when the bucket has not been created yet', async () => {
    const { client } = makeStorageClient({ listError: { message: 'Bucket not found' } });
    expect(await getCurrentUserGuide(client)).toBeNull();
  });

  it('throws on any other storage error rather than claiming there is no guide', async () => {
    const { client } = makeStorageClient({ listError: { message: 'permission denied' } });
    await expect(getCurrentUserGuide(client)).rejects.toThrow('permission denied');
  });
});

describe('getUserGuideView', () => {
  it('signs the newest guide', async () => {
    const { client, bucket } = makeStorageClient({ files: [`guide-${T1}.pdf`, `guide-${T2}.pdf`] });
    expect(await getUserGuideView(client)).toEqual({ url: `https://signed/guide-${T2}.pdf`, uploadedAt: new Date(T2).toISOString() });
    expect(bucket.createSignedUrl).toHaveBeenCalledWith(`guide-${T2}.pdf`, expect.any(Number));
  });

  it('returns null with no guide', async () => {
    expect(await getUserGuideView(makeStorageClient().client)).toBeNull();
  });
});

describe('createUserGuideUploadTarget', () => {
  it('keeps only the current guide, then returns a signed upload for a new timestamped file', async () => {
    const T0 = Date.UTC(2026, 0, 1);
    const { client, bucket, storage } = makeStorageClient({ files: [`guide-${T0}.pdf`, `guide-${T2}.pdf`, `guide-${T1}.pdf`] });
    const now = new Date(T2 + 1000);

    expect(await createUserGuideUploadTarget(client, now)).toEqual({ path: `guide-${T2 + 1000}.pdf`, token: 'upload-token' });
    expect(storage.createBucket).not.toHaveBeenCalled();
    expect(bucket.remove).toHaveBeenCalledWith([`guide-${T1}.pdf`, `guide-${T0}.pdf`]);
    expect(bucket.createSignedUploadUrl).toHaveBeenCalledWith(`guide-${T2 + 1000}.pdf`);
  });

  it('creates a private, PDF-only bucket on first use', async () => {
    const { client, storage, bucket } = makeStorageClient({ bucketExists: false });
    await createUserGuideUploadTarget(client);
    expect(storage.createBucket).toHaveBeenCalledWith(USER_GUIDE_BUCKET, {
      public: false,
      fileSizeLimit: USER_GUIDE_MAX_BYTES,
      allowedMimeTypes: ['application/pdf'],
    });
    expect(bucket.remove).not.toHaveBeenCalled();
  });

  it('still prepares the upload if removing old guides fails', async () => {
    const { client, bucket } = makeStorageClient({ files: [`guide-${T1}.pdf`, `guide-${T2}.pdf`] });
    bucket.remove.mockResolvedValue({ data: null, error: { message: 'boom' } });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(createUserGuideUploadTarget(client)).resolves.toMatchObject({ token: 'upload-token' });
    spy.mockRestore();
  });
});

describe('validateUserGuideFile', () => {
  const pdfHeader = new TextEncoder().encode('%PDF-1.7');
  const pdf = { name: 'guide.pdf', size: 800_000, type: 'application/pdf' };

  it('accepts a real PDF', () => {
    expect(validateUserGuideFile(pdf, pdfHeader)).toBeNull();
  });

  it('rejects a file that does not start like a PDF, whatever its name', () => {
    expect(validateUserGuideFile(pdf, new TextEncoder().encode('PK\u0003\u0004'))).toBe('Please choose a PDF file.');
  });

  it('rejects a non-PDF type', () => {
    expect(validateUserGuideFile({ ...pdf, type: 'image/png' }, pdfHeader)).toBe('Please choose a PDF file.');
  });

  it('rejects an oversized file', () => {
    expect(validateUserGuideFile({ ...pdf, size: USER_GUIDE_MAX_BYTES + 1 }, pdfHeader)).toMatch(/too large/);
  });
});

describe('formatGuideDate', () => {
  it('reads as a plain date', () => {
    expect(formatGuideDate('2026-10-15T03:00:00Z')).toBe('15 October 2026');
  });
});
