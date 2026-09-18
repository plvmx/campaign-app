import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { sendSms } from '../clickSendClient';

describe('sendSms', () => {
  const originalUsername = process.env.CLICKSEND_USERNAME;
  const originalApiKey = process.env.CLICKSEND_API_KEY;

  beforeEach(() => {
    process.env.CLICKSEND_USERNAME = 'test-user';
    process.env.CLICKSEND_API_KEY = 'test-key';
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    process.env.CLICKSEND_USERNAME = originalUsername;
    process.env.CLICKSEND_API_KEY = originalApiKey;
    vi.unstubAllGlobals();
  });

  it('throws when CLICKSEND_USERNAME/CLICKSEND_API_KEY are not set', async () => {
    delete process.env.CLICKSEND_USERNAME;
    delete process.env.CLICKSEND_API_KEY;
    await expect(sendSms('+61412345678', 'hi')).rejects.toThrow('CLICKSEND_USERNAME/CLICKSEND_API_KEY is not set');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('posts to ClickSend with Basic auth and the expected message shape', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: { messages: [{ status: 'SUCCESS', message_id: 'msg-123' }] } }),
    } as Response);

    const result = await sendSms('+61412345678', 'Hello leader');

    expect(fetch).toHaveBeenCalledWith(
      'https://rest.clicksend.com/v3/sms/send',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: `Basic ${Buffer.from('test-user:test-key').toString('base64')}`,
          'Content-Type': 'application/json',
        }),
      })
    );
    const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string);
    expect(body).toEqual({ messages: [{ source: 'campaign-app', to: '+61412345678', body: 'Hello leader' }] });
    expect(result).toEqual({ messageId: 'msg-123' });
  });

  it('throws with ClickSend\'s own error message on a non-ok response', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ response_msg: 'Invalid credentials' }),
    } as Response);

    await expect(sendSms('+61412345678', 'hi')).rejects.toThrow('Invalid credentials');
  });

  it('throws a generic message when a non-ok response has no parseable body', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => {
        throw new Error('not json');
      },
    } as unknown as Response);

    await expect(sendSms('+61412345678', 'hi')).rejects.toThrow('ClickSend request failed with status 500');
  });

  it('throws when ClickSend accepts the request but rejects the message itself', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: { messages: [{ status: 'INVALID_RECIPIENT' }] } }),
    } as Response);

    await expect(sendSms('+61412345678', 'hi')).rejects.toThrow('ClickSend rejected the message: INVALID_RECIPIENT');
  });
});
