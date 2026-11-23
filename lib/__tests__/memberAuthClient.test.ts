import { describe, it, expect, vi } from 'vitest';
import { fetchMemberInvite, fetchMemberMe, MEMBER_NETWORK_ERROR, requestMemberCodes, signOutMember, verifyMemberCodes } from '../memberAuthClient';
import { getMemberHelpEmail } from '../memberHelp';

const reply = (status: number, body: unknown) => vi.fn().mockResolvedValue({ status, json: () => Promise.resolve(body) });
const down = () => vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));

describe('fetchMemberInvite', () => {
  it('returns masked details', async () => {
    const f = reply(200, { maskedEmail: 'j•••@x.com', maskedMobile: '04•• ••• 678', eligible: true });
    expect(await fetchMemberInvite('tok', f)).toEqual({ status: 'ok', maskedEmail: 'j•••@x.com', maskedMobile: '04•• ••• 678', eligible: true });
    expect(f.mock.calls[0][0]).toBe('/api/member/invite?i=tok');
  });
  it('maps 404 to invalid, other failures and network loss to error', async () => {
    expect(await fetchMemberInvite('t', reply(404, { error: 'x' }))).toEqual({ status: 'invalid' });
    expect(await fetchMemberInvite('t', reply(500, { error: 'boom' }))).toEqual({ status: 'error', message: 'boom' });
    expect(await fetchMemberInvite('t', down())).toEqual({ status: 'error', message: MEMBER_NETWORK_ERROR });
  });
});

describe('requestMemberCodes', () => {
  it('posts the details and returns the verification id', async () => {
    const f = reply(200, { success: true, verificationId: 'vid', maskedEmail: 'a', maskedMobile: 'b' });
    expect(await requestMemberCodes({ email: 'e', mobile: 'm' }, f)).toEqual({ status: 'sent', verificationId: 'vid', maskedEmail: 'a', maskedMobile: 'b' });
    expect(JSON.parse(f.mock.calls[0][1].body)).toEqual({ email: 'e', mobile: 'm' });
  });
  it('passes server messages through, with a generic fallback and a network message', async () => {
    expect(await requestMemberCodes({ invite: 't' }, reply(429, { error: 'Please wait a minute' }))).toEqual({ status: 'error', message: 'Please wait a minute' });
    expect((await requestMemberCodes({ invite: 't' }, reply(500, {}))).status).toBe('error');
    expect(await requestMemberCodes({ invite: 't' }, down())).toEqual({ status: 'error', message: MEMBER_NETWORK_ERROR });
  });
});

describe('verifyMemberCodes', () => {
  const input = { verificationId: 'v', emailCode: '123456', smsCode: '654321' };
  it('is ok on success', async () => expect(await verifyMemberCodes(input, reply(200, { success: true }))).toEqual({ status: 'ok' }));
  it('keeps the failure code for expired/locked/invalid only', async () => {
    expect(await verifyMemberCodes(input, reply(400, { error: 'e', code: 'expired' }))).toEqual({ status: 'error', message: 'e', code: 'expired' });
    expect(await verifyMemberCodes(input, reply(400, { error: 'e', code: 'weird' }))).toEqual({ status: 'error', message: 'e', code: undefined });
    expect(await verifyMemberCodes(input, down())).toEqual({ status: 'error', message: MEMBER_NETWORK_ERROR });
  });
});

describe('fetchMemberMe / signOutMember', () => {
  it('reads the first name, and 401 means signed out', async () => {
    expect(await fetchMemberMe(reply(200, { firstName: 'Jane' }))).toEqual({ status: 'ok', firstName: 'Jane' });
    expect(await fetchMemberMe(reply(200, {}))).toEqual({ status: 'ok', firstName: null });
    expect(await fetchMemberMe(reply(401, {}))).toEqual({ status: 'signed_out' });
    expect((await fetchMemberMe(down())).status).toBe('error');
  });
  it('treats "already signed out" as success', async () => {
    expect(await signOutMember(true, reply(200, { success: true }))).toEqual({ ok: true });
    expect(await signOutMember(false, reply(401, {}))).toEqual({ ok: true });
    expect(await signOutMember(false, reply(500, {}))).toEqual({ ok: false });
    expect(await signOutMember(false, down())).toEqual({ ok: false });
  });
});

describe('getMemberHelpEmail', () => {
  it('returns a valid address and ignores anything else', () => {
    expect(getMemberHelpEmail(' help@afj.org.au ')).toBe('help@afj.org.au');
    for (const v of [undefined, null, '', 'nope']) expect(getMemberHelpEmail(v)).toBeNull();
  });
});
