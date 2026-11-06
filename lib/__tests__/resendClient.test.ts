import { describe, it, expect, vi, afterEach } from 'vitest';
import { DEFAULT_EMAIL_FROM, sendEmail } from '../resendClient';

const email = { to: ['a@x.com', 'b@x.com'], subject: 'S', html: '<p>h</p>', text: 't' };
const okFetch = () => vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'msg_1' }) }) as unknown as typeof fetch;

afterEach(() => {
  delete process.env.RESEND_API_KEY;
  delete process.env.CAMPAIGN_REPORT_EMAIL_FROM;
});

describe('sendEmail', () => {
  it('throws when RESEND_API_KEY is not set, without calling Resend', async () => {
    const fetchImpl = okFetch();
    await expect(sendEmail(email, fetchImpl)).rejects.toThrow('RESEND_API_KEY is not set');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('posts to Resend with the default sender and returns the message id', async () => {
    process.env.RESEND_API_KEY = 'key';
    const fetchImpl = okFetch();
    await expect(sendEmail(email, fetchImpl)).resolves.toEqual({ messageId: 'msg_1' });
    const [url, init] = vi.mocked(fetchImpl).mock.calls[0];
    expect(url).toBe('https://api.resend.com/emails');
    expect((init as RequestInit).headers).toMatchObject({ Authorization: 'Bearer key' });
    expect(JSON.parse((init as RequestInit).body as string)).toMatchObject({ from: DEFAULT_EMAIL_FROM, to: email.to, subject: 'S' });
  });

  it('uses CAMPAIGN_REPORT_EMAIL_FROM when set', async () => {
    process.env.RESEND_API_KEY = 'key';
    process.env.CAMPAIGN_REPORT_EMAIL_FROM = 'AFJ Reports <reports@afj.org.au>';
    const fetchImpl = okFetch();
    await sendEmail(email, fetchImpl);
    expect(JSON.parse((vi.mocked(fetchImpl).mock.calls[0][1] as RequestInit).body as string).from).toBe('AFJ Reports <reports@afj.org.au>');
  });

  it("throws Resend's message when the request is rejected", async () => {
    process.env.RESEND_API_KEY = 'key';
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 403, json: async () => ({ message: 'domain not verified' }) }) as unknown as typeof fetch;
    await expect(sendEmail(email, fetchImpl)).rejects.toThrow('domain not verified');
  });
});
