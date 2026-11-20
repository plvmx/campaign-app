import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { sendDonationNoticeEmail } from '../donationNoticeEmailService';
import { makeQueryBuilder } from './supabaseMock';

function makeClient(settings: Array<{ setting_key: string; setting_value: string }>, settingsError = false) {
  const from = vi.fn(() => makeQueryBuilder({ data: settings, error: settingsError ? { message: 'boom' } : null }));
  return { client: { from } as unknown as SupabaseClient };
}
const on = (recipients: string) => [
  { setting_key: 'donation_notice_email_enabled', setting_value: 'true' },
  { setting_key: 'donation_notice_email_recipients', setting_value: recipients },
];

describe('sendDonationNoticeEmail', () => {
  it('sends one email to every recipient with the donor details', async () => {
    const sender = vi.fn().mockResolvedValue({ messageId: 'm' });
    const { client } = makeClient(on('a@x.com, b@x.com'));
    await expect(sendDonationNoticeEmail(client, { name: 'Mary', email: 'mary@example.com', amount: '50' }, sender))
      .resolves.toEqual({ status: 'sent', recipients: 2 });
    const sent = sender.mock.calls[0][0];
    expect(sent.to).toEqual(['a@x.com', 'b@x.com']);
    expect(sent.subject).toBe('Bank Transfer Donation Notice — Mary');
  });

  it('does nothing when the switch is off or unset', async () => {
    const sender = vi.fn();
    for (const settings of [[], [{ setting_key: 'donation_notice_email_enabled', setting_value: 'false' }]]) {
      const { client } = makeClient(settings);
      await expect(sendDonationNoticeEmail(client, { name: 'Mary', email: null, amount: null }, sender)).resolves.toEqual({ status: 'disabled' });
    }
    expect(sender).not.toHaveBeenCalled();
  });

  it('does nothing when switched on with nobody listed or an invalid list', async () => {
    const sender = vi.fn();
    for (const list of ['', 'not-an-email']) {
      const { client } = makeClient(on(list));
      await expect(sendDonationNoticeEmail(client, { name: 'Mary', email: null, amount: null }, sender)).resolves.toEqual({ status: 'no_recipients' });
    }
    expect(sender).not.toHaveBeenCalled();
  });

  it('throws when the settings cannot be read or sending fails', async () => {
    await expect(sendDonationNoticeEmail(makeClient([], true).client, { name: 'Mary', email: null, amount: null }, vi.fn())).rejects.toThrow(/email settings/);
    const failing = vi.fn().mockRejectedValue(new Error('Resend down'));
    await expect(sendDonationNoticeEmail(makeClient(on('a@x.com')).client, { name: 'Mary', email: null, amount: null }, failing)).rejects.toThrow('Resend down');
  });
});
