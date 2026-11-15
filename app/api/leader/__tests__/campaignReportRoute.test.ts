import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

vi.mock('@/lib/supabaseClient', () => ({ supabase: { auth: {}, from: vi.fn() } }));
vi.mock('@/lib/supabaseAdmin', () => ({ supabaseAdmin: { name: 'admin-client' } }));

const authorize = vi.fn();
vi.mock('@/lib/leaderRouteGuard', () => ({ authorizeLeaderRequest: (...a: unknown[]) => authorize(...a) }));

const loadCampaign = vi.fn();
const savedNames = vi.fn();
const save = vi.fn();
vi.mock('@/lib/services/campaignReportSaveService', async (orig) => ({
  ...(await orig<typeof import('@/lib/services/campaignReportSaveService')>()),
  loadReportCampaign: (...a: unknown[]) => loadCampaign(...a),
  getSavedReportNames: (...a: unknown[]) => savedNames(...a),
  saveCampaignReport: (...a: unknown[]) => save(...a),
}));
const sendEmail = vi.fn();
vi.mock('@/lib/services/campaignReportEmailService', async (orig) => ({
  ...(await orig<typeof import('@/lib/services/campaignReportEmailService')>()),
  sendCampaignReportEmail: (...a: unknown[]) => sendEmail(...a),
}));

import { GET, POST } from '../campaign-report/route';

const campaign = { date: '2026-10-31', state: 'VIC', place: 'Orange', site: '1', leader: 'Jane Smith', mobile: '0400123456' };
const owner = { ok: true, userId: 'u1', caller: { adminStatus: null, state: 'VIC', leader: 'Jane Smith', mobile: '0400123456' }, sharedWithMeOwners: [] };
const stranger = { ...owner, caller: { adminStatus: null, state: 'VIC', leader: 'John Other', mobile: '0411111111' } };
const body = {
  campaignId: 'c1', partial: 1, full: 0, sinnersPrayers: 0, followUp: 0,
  names: { partial: ['Ann'], full: [], sinnersPrayers: [], followUp: [] },
};

const post = (b: unknown = body) =>
  POST(new NextRequest('http://localhost/api/leader/campaign-report', { method: 'POST', body: JSON.stringify(b), headers: { 'Content-Type': 'application/json' } }));
const get = (qs = '?campaignId=c1') => GET(new NextRequest(`http://localhost/api/leader/campaign-report${qs}`));

beforeEach(() => {
  for (const m of [authorize, loadCampaign, savedNames, save, sendEmail]) m.mockReset();
  authorize.mockResolvedValue(owner);
  loadCampaign.mockResolvedValue(campaign);
  savedNames.mockResolvedValue({ partial: ['Ann'], full: [], sinnersPrayers: [], followUp: [] });
  save.mockResolvedValue({ status: 'saved', names: 1 });
  sendEmail.mockResolvedValue({ status: 'sent', recipients: 2 });
});

describe('campaign-report route — who may use it', () => {
  it('passes the guard\'s refusal straight back, touching nothing else', async () => {
    authorize.mockResolvedValue({ ok: false, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) });
    expect((await get()).status).toBe(401);
    expect((await post()).status).toBe(401);
    expect(loadCampaign).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it('refuses (403) a leader who may not record results for the campaign: nothing is read back, saved or emailed', async () => {
    authorize.mockResolvedValue(stranger);
    expect((await get()).status).toBe(403);
    expect(savedNames).not.toHaveBeenCalled();
    expect((await post()).status).toBe(403);
    expect(save).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('lets a plain campaign leader (not an admin) through, and a full admin for anyone\'s campaign', async () => {
    expect((await post()).status).toBe(200);
    authorize.mockResolvedValue({ ...stranger, caller: { ...stranger.caller, adminStatus: 'AD' } });
    expect((await post()).status).toBe(200);
  });

  it('lets a leader the campaign was shared with through', async () => {
    authorize.mockResolvedValue({ ...stranger, sharedWithMeOwners: [{ owner_state: 'VIC', owner_leader: 'Jane Smith' }] });
    expect((await post()).status).toBe(200);
  });

  it('answers 404 for a campaign that does not exist', async () => {
    loadCampaign.mockResolvedValue(null);
    expect((await get()).status).toBe(404);
    expect((await post()).status).toBe(404);
  });
});

describe('GET /api/leader/campaign-report', () => {
  it('returns what the page pre-fills (location, leader, date) and the names already saved', async () => {
    const res = await get();
    expect(await res.json()).toEqual({
      campaign: { location: 'Orange 1 VIC', leader: 'Jane Smith', date: '31/10/2026' },
      names: { partial: ['Ann'], full: [], sinnersPrayers: [], followUp: [] },
    });
  });

  it('needs a campaign id', async () => {
    expect((await get('')).status).toBe(400);
  });
});

describe('POST /api/leader/campaign-report', () => {
  it('rejects an invalid body (400) without saving', async () => {
    expect((await post({ ...body, names: { ...body.names, partial: [] } })).status).toBe(400);
    expect(save).not.toHaveBeenCalled();
  });

  it('saves with the looked-up campaign and the caller\'s id, then emails the counts, reporting the outcome', async () => {
    const res = await post();
    expect(await res.json()).toEqual({ status: 'saved', names: 1, email: 'sent' });
    expect(save).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ campaign, actorUserId: 'u1', campaignId: 'c1' }));
    expect(sendEmail).toHaveBeenCalledWith(expect.anything(), { campaignId: 'c1', counts: { partial: 1, full: 0, sinnersPrayers: 0, followUp: 0 } });
  });

  it('reports "disabled" when management emailing is switched off', async () => {
    sendEmail.mockResolvedValue({ status: 'disabled' });
    expect((await (await post()).json()).email).toBe('disabled');
  });

  it('a failed email never undoes the save: still 200, email "failed"', async () => {
    sendEmail.mockRejectedValue(new Error('resend down'));
    const res = await post();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: 'saved', email: 'failed' });
  });

  it('a failed save is a 502 and sends no email', async () => {
    save.mockRejectedValue(new Error('db down'));
    const res = await post();
    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe('The report could not be saved.');
    expect(sendEmail).not.toHaveBeenCalled();
  });
});
