/**
 * Behaviour of /api/admin/tech-insights once the caller is a verified admin
 * (that non-admins are refused is pinned in adminRoutesRequireAdmin.test.ts).
 * The route must only ever serve source for paths the manifest lists.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/services/adminCallerService', () => ({
  verifyAdminCaller: vi.fn().mockResolvedValue({ ok: true, userId: 'u1', label: 'Admin (VIC)' }),
}));
vi.mock('@/lib/corsUtils', () => ({ enforceOrigin: () => null }));
vi.mock('@/lib/supabaseAdmin', () => ({ supabaseAdmin: {} }));

const mockLoadManifest = vi.fn();
const mockLoadSource = vi.fn();
vi.mock('@/lib/techInsights/manifestStore', () => ({
  loadManifest: () => mockLoadManifest(),
  loadSource: (p: string) => mockLoadSource(p),
}));

import { GET } from '../tech-insights/route';

const req = (query = '') =>
  new NextRequest(`http://localhost/api/admin/tech-insights${query}`, { headers: { Authorization: 'Bearer tok' } });

describe('GET /api/admin/tech-insights (verified admin)', () => {
  beforeEach(() => {
    mockLoadManifest.mockReset();
    mockLoadSource.mockReset();
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
  });

  it('returns 503 with guidance when the manifest has not been generated', async () => {
    mockLoadManifest.mockReturnValue(null);
    const res = await GET(req());
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/npm run tech-insights/);
  });

  it('returns the manifest, uncached', async () => {
    mockLoadManifest.mockReturnValue({ files: {}, routes: [] });
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ manifest: { files: {}, routes: [] } });
    expect(res.headers.get('Cache-Control')).toContain('no-store');
  });

  it('serves source for a path the manifest lists', async () => {
    mockLoadManifest.mockReturnValue({ files: { 'lib/a.ts': {} }, routes: [] });
    mockLoadSource.mockReturnValue('export const a = 1;');
    const res = await GET(req('?file=lib%2Fa.ts'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ path: 'lib/a.ts', source: 'export const a = 1;' });
  });

  it.each(['.env.local', '../../etc/passwd', 'lib/unlisted.ts', '__proto__', 'constructor'])(
    'refuses a path the manifest does not list: %s', async (file) => {
      mockLoadManifest.mockReturnValue({ files: { 'lib/a.ts': {} }, routes: [] });
      mockLoadSource.mockReturnValue('SECRET');
      const res = await GET(req(`?file=${encodeURIComponent(file)}`));
      expect(res.status).toBe(404);
      expect(mockLoadSource).not.toHaveBeenCalled();
    },
  );
});
