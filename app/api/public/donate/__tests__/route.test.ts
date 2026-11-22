import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/corsUtils', () => ({ enforceOrigin: () => null }));
vi.mock('@/lib/supabaseClient', () => ({ supabase: {} }));
vi.mock('@/lib/supabaseAdmin', () => ({ supabaseAdmin: {} }));
const sendDonationNoticeEmail = vi.fn();
vi.mock('@/lib/services/donationNoticeEmailService', () => ({
  sendDonationNoticeEmail: (...a: unknown[]) => sendDonationNoticeEmail(...a),
}));

import { POST } from '../route';

const post = (body: Record<string, unknown>) =>
  POST(new NextRequest('http://localhost/api/public/donate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }));

describe('POST /api/public/donate', () => {
  beforeEach(() => {
    sendDonationNoticeEmail.mockReset().mockResolvedValue({ status: 'sent', recipients: 1 });
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'k';
  });

  it('sends the notice email with the trimmed, validated fields', async () => {
    const res = await post({ name: '  Mary  ', email: 'mary@example.com', amount: '50' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
    expect(sendDonationNoticeEmail).toHaveBeenCalledWith(expect.anything(), { name: 'Mary', email: 'mary@example.com', amount: '50' });
  });

  it('treats a blank email/amount as not provided', async () => {
    await post({ name: 'Mary', email: '', amount: '' });
    expect(sendDonationNoticeEmail).toHaveBeenCalledWith(expect.anything(), { name: 'Mary', email: null, amount: null });
  });

  it('rejects a missing name without calling the email service', async () => {
    const res = await post({ name: '', email: '', amount: '' });
    expect(res.status).toBe(400);
    expect(sendDonationNoticeEmail).not.toHaveBeenCalled();
  });

  it('rejects an invalid email or amount', async () => {
    expect((await post({ name: 'Mary', email: 'nope', amount: '' })).status).toBe(400);
    expect((await post({ name: 'Mary', email: '', amount: '-5' })).status).toBe(400);
    expect(sendDonationNoticeEmail).not.toHaveBeenCalled();
  });

  it('still reports success to the donor when sending is disabled or has no recipients', async () => {
    sendDonationNoticeEmail.mockResolvedValue({ status: 'disabled' });
    const res = await post({ name: 'Mary', email: '', amount: '' });
    expect(res.status).toBe(200);
  });

  it('returns a 500 with a reassuring message when sending throws', async () => {
    sendDonationNoticeEmail.mockRejectedValue(new Error('Resend down'));
    const res = await post({ name: 'Mary', email: '', amount: '' });
    expect(res.status).toBe(500);
    expect((await res.json()).error).toMatch(/go ahead with the transfer anyway/);
  });
});
