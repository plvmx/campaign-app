import { describe, it, expect, vi, beforeEach } from 'vitest';

// campaignInterestSmsService.ts imports normalizeMobile from lib/auth.ts,
// which imports the real supabaseClient — mocked here so this test doesn't
// need real Supabase env vars, same pattern as lib/__tests__/auth.test.ts.
vi.mock('@/lib/supabaseClient', () => ({
  supabase: { auth: {}, from: vi.fn() },
}));

import {
  toE164AuMobile,
  groupCampaignsByLeader,
  buildLeaderSmsMessage,
  notifyLeadersOfCampaignInterest,
  type CampaignLeaderInfo,
} from '../campaignInterestSmsService';
import { makeQueryBuilder } from './supabaseMock';
import { sendSms } from '@/lib/clickSendClient';

vi.mock('@/lib/clickSendClient', () => ({
  sendSms: vi.fn(),
}));

vi.mock('@/lib/siteUrl', () => ({
  getSiteUrl: () => 'https://campaign.afj.org.au',
}));

describe('toE164AuMobile', () => {
  it('converts a valid local AU mobile to E.164', () => {
    expect(toE164AuMobile('0412 345 678')).toBe('+61412345678');
  });

  it('returns null for an invalid mobile', () => {
    expect(toE164AuMobile('12345')).toBeNull();
    expect(toE164AuMobile('')).toBeNull();
  });
});

describe('groupCampaignsByLeader', () => {
  const c = (overrides: Partial<CampaignLeaderInfo>): CampaignLeaderInfo => ({
    id: 'id',
    state: 'NSW',
    leader: 'Jane Doe',
    date: '2026-10-12',
    place: 'Orange',
    site: '1',
    time: '2:00 PM',
    ...overrides,
  });

  it('groups campaigns by state+leader', () => {
    const campaigns = [
      c({ id: '1', leader: 'Jane Doe' }),
      c({ id: '2', leader: 'Jane Doe' }),
      c({ id: '3', leader: 'John Smith' }),
    ];
    const groups = groupCampaignsByLeader(campaigns);
    expect(groups.size).toBe(2);
    expect(groups.get('NSW::Jane Doe')?.campaigns).toHaveLength(2);
    expect(groups.get('NSW::John Smith')?.campaigns).toHaveLength(1);
  });

  it('keeps the same leader name in different states separate', () => {
    const campaigns = [c({ id: '1', state: 'NSW' }), c({ id: '2', state: 'VIC' })];
    const groups = groupCampaignsByLeader(campaigns);
    expect(groups.size).toBe(2);
  });
});

describe('buildLeaderSmsMessage', () => {
  const c = (overrides: Partial<CampaignLeaderInfo>): CampaignLeaderInfo => ({
    id: 'id',
    state: 'NSW',
    leader: 'Jane Doe',
    date: '2026-10-12',
    place: 'Orange',
    site: '1',
    time: '2:00 PM',
    ...overrides,
  });

  it('formats a single-campaign message', () => {
    const msg = buildLeaderSmsMessage('Sam', 'in', [c({})]);
    expect(msg).toBe(
      '<Important AFJ Notification> Sam has registered interest ("Yes I\'m In") in your campaign at Orange 1, 12 Oct 2:00 PM. View details here: https://campaign.afj.org.au/campaign-interest'
    );
  });

  it('formats a multi-campaign message with a "Tell Me More" label', () => {
    const msg = buildLeaderSmsMessage('Sam', 'more', [
      c({ place: 'Orange', site: '1', date: '2026-10-12' }),
      c({ place: 'Bathurst', site: '', date: '2026-10-14' }),
    ]);
    expect(msg).toBe(
      '<Important AFJ Notification> Sam has registered interest ("Tell Me More") in 2 of your campaigns: Orange 1 (12 Oct), Bathurst (14 Oct). View details here: https://campaign.afj.org.au/campaign-interest'
    );
  });
});

describe('notifyLeadersOfCampaignInterest', () => {
  const campaignsRow = (overrides: Partial<CampaignLeaderInfo> = {}): CampaignLeaderInfo => ({
    id: 'campaign-1',
    state: 'NSW',
    leader: 'Jane Doe',
    date: '2026-10-12',
    place: 'Orange',
    site: '1',
    time: '2:00 PM',
    ...overrides,
  });

  function makeClient(opts: {
    campaigns: CampaignLeaderInfo[];
    leaderMobile: string | null;
  }) {
    const inserted: unknown[] = [];
    const from = vi.fn((table: string) => {
      if (table === 'campaigns') {
        return makeQueryBuilder({ data: opts.campaigns, error: null });
      }
      if (table === 'state_leaders') {
        return makeQueryBuilder({ data: opts.leaderMobile ? { mobile: opts.leaderMobile } : null, error: null });
      }
      if (table === 'campaign_interest_sms_log') {
        const builder = makeQueryBuilder({ data: null, error: null });
        builder.insert = vi.fn((row: unknown) => {
          inserted.push(row);
          return builder;
        });
        return builder;
      }
      throw new Error(`Unexpected table: ${table}`);
    });
    return { from: from as unknown, inserted };
  }

  beforeEach(() => {
    vi.mocked(sendSms).mockReset();
  });

  it('sends one combined text for a leader with multiple ticked campaigns', async () => {
    vi.mocked(sendSms).mockResolvedValue({ messageId: 'msg-1' });
    const campaigns = [
      campaignsRow({ id: 'c1' }),
      campaignsRow({ id: 'c2', place: 'Bathurst', site: '' }),
    ];
    const { from, inserted } = makeClient({ campaigns, leaderMobile: '0412345678' });

    await notifyLeadersOfCampaignInterest({ from } as never, {
      campaignIds: ['c1', 'c2'],
      registrantFirstName: 'Sam',
      interestType: 'in',
    });

    expect(sendSms).toHaveBeenCalledTimes(1);
    expect(sendSms).toHaveBeenCalledWith('+61412345678', expect.stringContaining('2 of your campaigns'));
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({ status: 'sent', state: 'NSW', leader: 'Jane Doe', clicksend_message_id: 'msg-1' });
  });

  it('sends a separate text per distinct leader', async () => {
    vi.mocked(sendSms).mockResolvedValue({ messageId: 'msg-1' });
    const campaigns = [
      campaignsRow({ id: 'c1', leader: 'Jane Doe' }),
      campaignsRow({ id: 'c2', leader: 'John Smith' }),
    ];
    const { from } = makeClient({ campaigns, leaderMobile: '0412345678' });

    await notifyLeadersOfCampaignInterest({ from } as never, {
      campaignIds: ['c1', 'c2'],
      registrantFirstName: 'Sam',
      interestType: 'in',
    });

    expect(sendSms).toHaveBeenCalledTimes(2);
  });

  it('logs skipped_no_mobile and does not call sendSms when the leader has no mobile on file', async () => {
    const campaigns = [campaignsRow({ id: 'c1' })];
    const { from, inserted } = makeClient({ campaigns, leaderMobile: null });

    await notifyLeadersOfCampaignInterest({ from } as never, {
      campaignIds: ['c1'],
      registrantFirstName: 'Sam',
      interestType: 'in',
    });

    expect(sendSms).not.toHaveBeenCalled();
    expect(inserted[0]).toMatchObject({ status: 'skipped_no_mobile', mobile: null });
  });

  it('logs a failed status and does not throw when sendSms rejects', async () => {
    vi.mocked(sendSms).mockRejectedValue(new Error('ClickSend is down'));
    const campaigns = [campaignsRow({ id: 'c1' })];
    const { from, inserted } = makeClient({ campaigns, leaderMobile: '0412345678' });

    await expect(
      notifyLeadersOfCampaignInterest({ from } as never, {
        campaignIds: ['c1'],
        registrantFirstName: 'Sam',
        interestType: 'in',
      })
    ).resolves.toBeUndefined();

    expect(inserted[0]).toMatchObject({ status: 'failed', error: 'ClickSend is down' });
  });

  it('does nothing when no campaign resolves to a state+leader', async () => {
    const campaigns = [campaignsRow({ id: 'c1', state: '', leader: '' })];
    const { from } = makeClient({ campaigns, leaderMobile: '0412345678' });

    await notifyLeadersOfCampaignInterest({ from } as never, {
      campaignIds: ['c1'],
      registrantFirstName: 'Sam',
      interestType: 'in',
    });

    expect(sendSms).not.toHaveBeenCalled();
  });
});
