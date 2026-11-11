/** /api/admin/settings must only accept well-formed Tech Insights values — a bad shortcut would mis-bind it for every admin. */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/services/adminCallerService', () => ({
  verifyAdminCaller: vi.fn().mockResolvedValue({ ok: true, userId: 'u1', label: 'Admin (VIC)' }),
}));
vi.mock('@/lib/corsUtils', () => ({ enforceOrigin: () => null }));
const upsert = vi.fn().mockResolvedValue({ error: null });
vi.mock('@/lib/supabaseAdmin', () => ({ supabaseAdmin: { from: () => ({ upsert }) } }));

import { POST } from '../settings/route';

const post = (key: string, value: string) =>
  POST(new NextRequest('http://localhost/api/admin/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok' },
    body: JSON.stringify({ key, value }),
  }));

describe('POST /api/admin/settings — Tech Insights keys', () => {
  beforeEach(() => {
    upsert.mockClear();
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
  });

  it('stores a canonical shortcut and a true/false flag', async () => {
    expect((await post('tech_insights_hotkey', 'Ctrl+Alt+J')).status).toBe(200);
    expect((await post('tech_insights_enabled', 'true')).status).toBe(200);
    expect(upsert).toHaveBeenCalledTimes(2);
  });

  it.each(['Shift+J', 'banana', 'ctrl+alt+j', 'Alt+Ctrl+J', ''])('rejects the shortcut %j', async (value) => {
    expect((await post('tech_insights_hotkey', value)).status).toBe(400);
    expect(upsert).not.toHaveBeenCalled();
  });

  it.each(['yes', 'TRUE', '1'])('rejects the enabled flag %j', async (value) => {
    expect((await post('tech_insights_enabled', value)).status).toBe(400);
    expect(upsert).not.toHaveBeenCalled();
  });
});
