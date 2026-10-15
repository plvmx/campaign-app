/**
 * Anyone may get a link to the guide (it's offered on the sign-in screen —
 * Peter, 2026-10-15); the route must still refuse cross-origin callers.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const mockView = vi.fn();
const mockEnforceOrigin = vi.fn();
vi.mock('@/lib/corsUtils', () => ({ enforceOrigin: (r: NextRequest) => mockEnforceOrigin(r) }));
vi.mock('@/lib/supabaseAdmin', () => ({ supabaseAdmin: {} }));
vi.mock('@/lib/services/userGuideService', () => ({ getUserGuideView: (...a: unknown[]) => mockView(...a) }));

import { GET } from '../route';

const req = () => new NextRequest('http://localhost/api/public/user-guide');

describe('GET /api/public/user-guide', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'k';
    mockEnforceOrigin.mockReturnValue(null);
    mockView.mockResolvedValue({ url: 'https://signed/guide.pdf', uploadedAt: '2026-10-15T00:00:00.000Z' });
  });

  it('returns the signed link without any sign-in', async () => {
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ url: 'https://signed/guide.pdf', uploadedAt: '2026-10-15T00:00:00.000Z' });
  });

  it('returns { url: null } when no guide has been uploaded', async () => {
    mockView.mockResolvedValue(null);
    expect(await (await GET(req())).json()).toEqual({ url: null });
  });

  it('refuses a cross-origin caller before touching storage', async () => {
    mockEnforceOrigin.mockReturnValue(NextResponse.json({ error: 'Forbidden' }, { status: 403 }));
    expect((await GET(req())).status).toBe(403);
    expect(mockView).not.toHaveBeenCalled();
  });

  it('500s with a readable message when storage fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mockView.mockRejectedValue(new Error('boom'));
    const res = await GET(req());
    expect(res.status).toBe(500);
    expect((await res.json()).error).toMatch(/could not be loaded/);
  });
});
