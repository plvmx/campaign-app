import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { parseReportCounts, sendCampaignReportEmail } from '../campaignReportEmailService';
import { makeQueryBuilder } from './supabaseMock';

const counts = { partial: 0, full: 5, sinnersPrayers: 5 };
const campaignRow = { date: '2024-09-30', state: 'NSW', place: 'Sylvania', site: '', leader: 'Marie H' };

function makeClient(opts: { settings?: Array<{ setting_key: string; setting_value: string }>; campaign?: unknown; settingsError?: boolean }) {
  const from = vi.fn((table: string) =>
    table === 'app_settings'
      ? makeQueryBuilder({ data: opts.settings ?? [], error: opts.settingsError ? { message: 'boom' } : null })
      : makeQueryBuilder({ data: opts.campaign === undefined ? campaignRow : opts.campaign, error: null }),
  );
  return { client: { from } as unknown as SupabaseClient, from };
}
const on = (recipients: string) => [
  { setting_key: 'campaign_report_email_enabled', setting_value: 'true' },
  { setting_key: 'campaign_report_email_recipients', setting_value: recipients },
];

describe('parseReportCounts', () => {
  it('accepts three whole numbers 0-99', () => {
    expect(parseReportCounts({ partial: 0, full: 5, sinnersPrayers: 99, extra: 1 })).toEqual({ partial: 0, full: 5, sinnersPrayers: 99 });
  });
  it.each([null, 'x', {}, { partial: 1, full: 2 }, { partial: '1', full: 2, sinnersPrayers: 3 }, { partial: 100, full: 0, sinnersPrayers: 0 }, { partial: -1, full: 0, sinnersPrayers: 0 }])(
    'rejects %j', (body) => expect(parseReportCounts(body)).toBeNull(),
  );
});

describe('sendCampaignReportEmail', () => {
  it('sends one email to every recipient with the campaign details and counts', async () => {
    const sender = vi.fn().mockResolvedValue({ messageId: 'm' });
    const { client } = makeClient({ settings: on('a@x.com, b@x.com') });
    await expect(sendCampaignReportEmail(client, { campaignId: 'c1', counts }, sender)).resolves.toEqual({ status: 'sent', recipients: 2 });
    const sent = sender.mock.calls[0][0];
    expect(sent.to).toEqual(['a@x.com', 'b@x.com']);
    expect(sent.subject).toBe('TWOL Campaign Report — Sylvania NSW — 30/09/2024');
    expect(sent.text).toContain('Campaign Leader: Marie H');
    expect(sent.text).toContain('Number of Full Presentations: 5');
  });

  it('does nothing when the switch is off or unset, without loading the campaign', async () => {
    const sender = vi.fn();
    for (const settings of [[], [{ setting_key: 'campaign_report_email_enabled', setting_value: 'false' }]]) {
      const { client, from } = makeClient({ settings });
      await expect(sendCampaignReportEmail(client, { campaignId: 'c1', counts }, sender)).resolves.toEqual({ status: 'disabled' });
      expect(from).not.toHaveBeenCalledWith('campaigns');
    }
    expect(sender).not.toHaveBeenCalled();
  });

  it('does nothing when switched on with nobody listed or an invalid list', async () => {
    const sender = vi.fn();
    for (const list of ['', 'not-an-email']) {
      const { client } = makeClient({ settings: on(list) });
      await expect(sendCampaignReportEmail(client, { campaignId: 'c1', counts }, sender)).resolves.toEqual({ status: 'no_recipients' });
    }
    expect(sender).not.toHaveBeenCalled();
  });

  it('reports a missing campaign without sending', async () => {
    const sender = vi.fn();
    const { client } = makeClient({ settings: on('a@x.com'), campaign: null });
    await expect(sendCampaignReportEmail(client, { campaignId: 'nope', counts }, sender)).resolves.toEqual({ status: 'campaign_not_found' });
    expect(sender).not.toHaveBeenCalled();
  });

  it('throws when the settings cannot be read or sending fails', async () => {
    await expect(sendCampaignReportEmail(makeClient({ settingsError: true }).client, { campaignId: 'c1', counts }, vi.fn())).rejects.toThrow(/email settings/);
    const failing = vi.fn().mockRejectedValue(new Error('Resend down'));
    await expect(sendCampaignReportEmail(makeClient({ settings: on('a@x.com') }).client, { campaignId: 'c1', counts }, failing)).rejects.toThrow('Resend down');
  });
});
