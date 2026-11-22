/** /api/admin/settings must only accept a well-formed report-email flag and recipient list (max 4, valid, no repeats). */
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

describe('POST /api/admin/settings — campaign report email keys', () => {
  beforeEach(() => {
    upsert.mockClear();
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
  });

  it('stores a valid recipient list, an empty list and a true/false flag', async () => {
    expect((await post('campaign_report_email_recipients', 'a@example.com, b@example.com')).status).toBe(200);
    expect((await post('campaign_report_email_recipients', '')).status).toBe(200);
    expect((await post('campaign_report_email_enabled', 'false')).status).toBe(200);
    expect(upsert).toHaveBeenCalledTimes(3);
  });

  it.each([
    'a@example.com, not-an-email',
    'a@example.com, A@EXAMPLE.com',
    'a@x.com,b@x.com,c@x.com,d@x.com,e@x.com',
  ])('rejects the recipient list %j', async (value) => {
    expect((await post('campaign_report_email_recipients', value)).status).toBe(400);
    expect(upsert).not.toHaveBeenCalled();
  });

  it.each(['yes', 'TRUE', ''])('rejects the enabled flag %j', async (value) => {
    expect((await post('campaign_report_email_enabled', value)).status).toBe(400);
    expect(upsert).not.toHaveBeenCalled();
  });
});
