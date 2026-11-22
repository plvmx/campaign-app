import { describe, it, expect, vi } from 'vitest';
import {
  createMemberInvite, getMemberSession, isEligibleForSignIn, isPlaceholderEmail, lookupInvite,
  requestCodes, revokeAllMemberSessions, revokeMemberSession, verifyCodes,
  MEMBER_MAX_VERIFY_ATTEMPTS, MEMBER_VERIFY_FAILS_PER_IP_PER_HOUR,
  type MemberAuthDeps,
} from '../memberAuthService';
import { hashCode, hashToken } from '@/lib/memberCodes';
import { MEMBER_THROTTLE } from '@/lib/memberThrottle';
import { makeRegistryFake, type FakeCall, type FakeResult } from './memberFakeClient';

const SECRET = 'x'.repeat(40);
const NOW = new Date('2026-11-23T10:00:00.000Z');
const jane = { id: 'r1', first_name: 'Jane', email: 'jane@gmail.com', phone: '+61412345678' };
const VID = '11111111-1111-4111-8111-111111111111';

function makeDeps(over: Partial<MemberAuthDeps> = {}) {
  const sendEmail = vi.fn().mockResolvedValue({});
  const sendSms = vi.fn().mockResolvedValue({});
  const deps: MemberAuthDeps = { secret: SECRET, sendEmail, sendSms, now: () => NOW, ...over };
  return { deps, sendEmail, sendSms };
}

/** Event-count answers, chosen by what the query is counting. */
function eventCount(call: FakeCall, counts: Partial<Record<'cooldown' | 'window' | 'day' | 'ip' | 'sms' | 'verifyBad', number>>): number {
  const eqCols = call.filters.filter(([m]) => m === 'eq').map(([, a]) => a[0]);
  const events = (call.filters.find(([m]) => m === 'in')?.[1][1] as string[]) ?? [];
  const since = new Date(call.filters.find(([m]) => m === 'gte')?.[1][1] as string);
  const age = NOW.getTime() - since.getTime();
  if (events.includes('verify_bad')) return counts.verifyBad ?? 0;
  if (eqCols.includes('ip_hash')) return counts.ip ?? 0;
  if (!eqCols.includes('registrant_id')) return counts.sms ?? 0;
  if (age === MEMBER_THROTTLE.resendCooldownMs) return counts.cooldown ?? 0;
  if (age === MEMBER_THROTTLE.perPersonWindowMs) return counts.window ?? 0;
  return counts.day ?? 0;
}

function sendScenario(opts: { registrants?: unknown[]; counts?: Parameters<typeof eventCount>[1]; invite?: unknown } = {}) {
  const registrants = opts.registrants ?? [jane];
  return makeRegistryFake((call) => {
    if (call.table === 'member_auth_events' && call.op === 'select') return { count: eventCount(call, opts.counts ?? {}) };
    if (call.table === 'registrants') {
      const byId = call.filters.find(([m, a]) => m === 'eq' && a[0] === 'id');
      return { data: byId ? registrants[0] ?? null : registrants };
    }
    if (call.table === 'member_invites' && call.op === 'select') return { data: opts.invite ?? null };
    return undefined;
  });
}

describe('isPlaceholderEmail / isEligibleForSignIn', () => {
  it('recognises the registry placeholder addresses', () => {
    expect(isPlaceholderEmail('noemail@noemail.com')).toBe(true);
    expect(isPlaceholderEmail('Jane@gmail.com')).toBe(false);
  });
  it('needs a usable email AND a mobile', () => {
    expect(isEligibleForSignIn({ email: 'jane@gmail.com', phone: '+61412345678' })).toBe(true);
    expect(isEligibleForSignIn({ email: 'jane@gmail.com', phone: null })).toBe(false);
    expect(isEligibleForSignIn({ email: null, phone: '+61412345678' })).toBe(false);
    expect(isEligibleForSignIn({ email: 'noemail@noemail.com', phone: '+61412345678' })).toBe(false);
  });
});

describe('requestCodes', () => {
  const typed = { via: 'typed' as const, email: ' Jane@Gmail.com ', mobile: '0412 345 678' };

  it('sends one code by email and one by text to the details ON FILE, storing only hashes', async () => {
    const fake = sendScenario();
    const { deps, sendEmail, sendSms } = makeDeps();
    const result = await requestCodes(fake.client, deps, typed, '1.2.3.4');

    expect(result).toMatchObject({ status: 'sent', maskedEmail: 'j•••@gmail.com', maskedMobile: '04•• ••• 678' });
    expect(sendEmail.mock.calls[0][0].to).toEqual(['jane@gmail.com']);
    expect(sendSms.mock.calls[0][0]).toBe('+61412345678');

    const emailCode = /sign-in code is: (\d{6})/.exec(sendEmail.mock.calls[0][0].text)![1];
    const smsCode = /code is (\d{6})/.exec(sendSms.mock.calls[0][1])![1];
    const stored = fake.where('member_verifications', 'insert')[0].values!;
    expect(stored.email_code_hash).toBe(hashCode(emailCode, stored.id as string, 'email', SECRET));
    expect(stored.sms_code_hash).toBe(hashCode(smsCode, stored.id as string, 'sms', SECRET));
    expect(JSON.stringify(fake.calls)).not.toContain(`"${emailCode}"`);
    expect(JSON.stringify(fake.calls)).not.toContain(`"${smsCode}"`);
    expect(fake.where('member_auth_events', 'insert')[0].values).toMatchObject({ event: 'codes_sent', registrant_id: 'r1' });
  });

  it('refuses typed details whose email and mobile belong to different people (nothing is sent)', async () => {
    const fake = sendScenario({ registrants: [{ ...jane, phone: '+61499999999' }] });
    const { deps, sendEmail, sendSms } = makeDeps();
    expect(await requestCodes(fake.client, deps, typed, '1.2.3.4')).toEqual({ status: 'no_match' });
    expect(sendEmail).not.toHaveBeenCalled();
    expect(sendSms).not.toHaveBeenCalled();
    expect(fake.where('member_verifications', 'insert')).toHaveLength(0);
  });

  it('refuses an unknown email, a registrant with no mobile, and a placeholder email', async () => {
    for (const registrants of [[], [{ ...jane, phone: null }], [{ ...jane, email: 'noemail@noemail.com' }]]) {
      const fake = sendScenario({ registrants });
      const { deps, sendEmail, sendSms } = makeDeps();
      expect(await requestCodes(fake.client, deps, typed, '1.2.3.4')).toEqual({ status: 'no_match' });
      expect(sendEmail).not.toHaveBeenCalled();
      expect(sendSms).not.toHaveBeenCalled();
    }
  });

  it.each([
    ['cooldown', { cooldown: 1 }],
    ['person_window', { window: MEMBER_THROTTLE.perPersonWindowMax }],
    ['person_day', { day: MEMBER_THROTTLE.perPersonDayMax }],
    ['sms_ceiling', { sms: MEMBER_THROTTLE.defaultDailySmsCeiling }],
  ] as const)('throttles on %s without sending anything', async (reason, counts) => {
    const fake = sendScenario({ counts });
    const { deps, sendEmail, sendSms } = makeDeps();
    expect(await requestCodes(fake.client, deps, typed, '1.2.3.4')).toEqual({ status: 'throttled', reason });
    expect(sendEmail).not.toHaveBeenCalled();
    expect(sendSms).not.toHaveBeenCalled();
  });

  it('honours an admin-set SMS ceiling', async () => {
    const fake = sendScenario({ counts: { sms: 5 } });
    const { deps } = makeDeps({ smsCeiling: 5 });
    expect(await requestCodes(fake.client, deps, typed, '1.2.3.4')).toEqual({ status: 'throttled', reason: 'sms_ceiling' });
  });

  it('refuses an over-limit IP before even looking anyone up', async () => {
    const fake = sendScenario({ counts: { ip: MEMBER_THROTTLE.perIpWindowMax } });
    const { deps } = makeDeps();
    expect(await requestCodes(fake.client, deps, typed, '1.2.3.4')).toEqual({ status: 'throttled', reason: 'ip' });
    expect(fake.where('registrants', 'select')).toHaveLength(0);
  });

  it('retires the codes and logs it when the text message fails', async () => {
    const fake = sendScenario();
    const { deps, sendEmail, sendSms } = makeDeps();
    sendSms.mockRejectedValue(new Error('ClickSend down'));
    expect(await requestCodes(fake.client, deps, typed, '1.2.3.4')).toEqual({ status: 'send_failed' });
    expect(sendEmail).toHaveBeenCalled();
    const events = fake.where('member_auth_events', 'insert').map((c) => c.values);
    expect(events).toContainEqual(expect.objectContaining({ event: 'sms_failed', detail: 'ClickSend down' }));
    expect(events.find((e) => e?.event === 'codes_sent')).toBeUndefined();
    expect(fake.where('member_verifications', 'update')[0].values).toHaveProperty('consumed_at');
  });

  it('works from an invite link, using the registrant the link points at', async () => {
    const invite = { id: 7, registrant_id: 'r1', expires_at: '2026-12-31T00:00:00Z', revoked_at: null };
    const fake = sendScenario({ invite });
    const { deps, sendSms } = makeDeps();
    const result = await requestCodes(fake.client, deps, { via: 'invite', inviteToken: 'a'.repeat(43) }, '1.2.3.4');
    expect(result.status).toBe('sent');
    expect(sendSms.mock.calls[0][0]).toBe('+61412345678');
    expect(fake.where('member_verifications', 'insert')[0].values).toMatchObject({ invite_id: 7 });
  });

  it('answers an unknown invite like any other non-match', async () => {
    const fake = sendScenario({ invite: null });
    const { deps, sendEmail } = makeDeps();
    expect(await requestCodes(fake.client, deps, { via: 'invite', inviteToken: 'a'.repeat(43) }, '1.2.3.4')).toEqual({ status: 'no_match' });
    expect(sendEmail).not.toHaveBeenCalled();
  });
});

describe('verifyCodes', () => {
  const EMAIL_CODE = '123456';
  const SMS_CODE = '654321';
  const baseRow = () => ({
    id: VID, registrant_id: 'r1',
    email_code_hash: hashCode(EMAIL_CODE, VID, 'email', SECRET),
    sms_code_hash: hashCode(SMS_CODE, VID, 'sms', SECRET),
    expires_at: '2026-11-23T10:05:00.000Z', attempts: 0, consumed_at: null as string | null,
  });
  const input = (over = {}) => ({ verificationId: VID, emailCode: EMAIL_CODE, smsCode: SMS_CODE, ...over });
  const ctx = { ip: '1.2.3.4', userAgent: 'TestAgent/1.0' };

  function scenario(row: ReturnType<typeof baseRow> | null, opts: { bump?: FakeResult; consume?: FakeResult; verifyBad?: number } = {}) {
    return makeRegistryFake((call) => {
      if (call.table === 'member_auth_events' && call.op === 'select') return { count: opts.verifyBad ?? 0 };
      if (call.table === 'member_verifications' && call.op === 'select') return { data: row };
      if (call.table === 'member_verifications' && call.op === 'update') {
        const isBump = call.values && 'attempts' in call.values;
        return isBump ? opts.bump ?? { data: [{ id: VID }] } : opts.consume ?? { data: [{ id: VID }] };
      }
      return undefined;
    });
  }

  it('signs in when BOTH codes are right: counts the attempt, burns the codes, stores only a session hash', async () => {
    const fake = scenario(baseRow());
    const { deps } = makeDeps();
    const result = await verifyCodes(fake.client, deps, input(), ctx);
    expect(result).toMatchObject({ ok: true, registrantId: 'r1' });
    if (!result.ok) throw new Error('unreachable');

    const updates = fake.where('member_verifications', 'update');
    expect(updates[0].values).toEqual({ attempts: 1 });
    expect(updates[1].values).toHaveProperty('consumed_at');
    expect(updates[1].filters).toContainEqual(['is', ['consumed_at', null]]);

    const session = fake.where('member_sessions', 'insert')[0].values!;
    expect(session.session_hash).toBe(hashToken(result.sessionId));
    expect(JSON.stringify(session)).not.toContain(result.sessionId);
    expect(session.device_label).toBe('TestAgent/1.0');
    expect(fake.where('member_auth_events', 'insert')[0].values).toMatchObject({ event: 'verify_ok' });
  });

  it('rejects a wrong text-message code, with no session', async () => {
    const fake = scenario(baseRow());
    const result = await verifyCodes(fake.client, makeDeps().deps, input({ smsCode: '000000' }), ctx);
    expect(result).toEqual({ ok: false, reason: 'invalid' });
    expect(fake.where('member_sessions', 'insert')).toHaveLength(0);
    expect(fake.where('member_auth_events', 'insert')[0].values).toMatchObject({ event: 'verify_bad' });
  });

  it('rejects the two codes typed into the wrong boxes', async () => {
    const fake = scenario(baseRow());
    const result = await verifyCodes(fake.client, makeDeps().deps, input({ emailCode: SMS_CODE, smsCode: EMAIL_CODE }), ctx);
    expect(result).toEqual({ ok: false, reason: 'invalid' });
  });

  it('locks after the maximum number of wrong tries', async () => {
    const fake = scenario({ ...baseRow(), attempts: MEMBER_MAX_VERIFY_ATTEMPTS - 1 });
    const result = await verifyCodes(fake.client, makeDeps().deps, input({ smsCode: '000000' }), ctx);
    expect(result).toEqual({ ok: false, reason: 'locked' });
    const events = fake.where('member_auth_events', 'insert').map((c) => c.values?.event);
    expect(events).toEqual(['verify_bad', 'verify_locked']);
  });

  it('refuses even the right codes once locked', async () => {
    const fake = scenario({ ...baseRow(), attempts: MEMBER_MAX_VERIFY_ATTEMPTS });
    expect(await verifyCodes(fake.client, makeDeps().deps, input(), ctx)).toEqual({ ok: false, reason: 'locked' });
    expect(fake.where('member_sessions', 'insert')).toHaveLength(0);
  });

  it('reports expired codes, and treats used or unknown ones as simply invalid', async () => {
    const expired = scenario({ ...baseRow(), expires_at: '2026-11-23T09:59:00.000Z' });
    expect(await verifyCodes(expired.client, makeDeps().deps, input(), ctx)).toEqual({ ok: false, reason: 'expired' });
    const used = scenario({ ...baseRow(), consumed_at: '2026-11-23T09:58:00.000Z' });
    expect(await verifyCodes(used.client, makeDeps().deps, input(), ctx)).toEqual({ ok: false, reason: 'invalid' });
    const unknown = scenario(null);
    expect(await verifyCodes(unknown.client, makeDeps().deps, input(), ctx)).toEqual({ ok: false, reason: 'invalid' });
    expect(unknown.where('member_sessions', 'insert')).toHaveLength(0);
  });

  it('does not let parallel guesses each get a free try (attempt count changed underneath)', async () => {
    const fake = scenario(baseRow(), { bump: { data: [] } });
    expect(await verifyCodes(fake.client, makeDeps().deps, input(), ctx)).toEqual({ ok: false, reason: 'invalid' });
    expect(fake.where('member_sessions', 'insert')).toHaveLength(0);
  });

  it('is single-use: losing the race to consume the codes yields no session', async () => {
    const fake = scenario(baseRow(), { consume: { data: [] } });
    expect(await verifyCodes(fake.client, makeDeps().deps, input(), ctx)).toEqual({ ok: false, reason: 'invalid' });
    expect(fake.where('member_sessions', 'insert')).toHaveLength(0);
  });

  it('turns away an IP with too many recent wrong answers', async () => {
    const fake = scenario(baseRow(), { verifyBad: MEMBER_VERIFY_FAILS_PER_IP_PER_HOUR });
    expect(await verifyCodes(fake.client, makeDeps().deps, input(), ctx)).toEqual({ ok: false, reason: 'too_many' });
    expect(fake.where('member_verifications', 'select')).toHaveLength(0);
  });

  it('rejects a malformed verification id without touching the database', async () => {
    const fake = scenario(baseRow());
    expect(await verifyCodes(fake.client, makeDeps().deps, input({ verificationId: 'nope' }), ctx)).toEqual({ ok: false, reason: 'invalid' });
    expect(fake.where('member_verifications', 'select')).toHaveLength(0);
  });
});

describe('invites', () => {
  it('stores only a hash of the token and returns the raw token once', async () => {
    const fake = makeRegistryFake(() => undefined);
    const token = await createMemberInvite(fake.client, { now: () => NOW }, 'r1', 30);
    const values = fake.where('member_invites', 'insert')[0].values!;
    expect(values.token_hash).toBe(hashToken(token));
    expect(JSON.stringify(values)).not.toContain(token);
    expect(values.expires_at).toBe('2026-12-23T10:00:00.000Z');
  });

  it('shows a valid invite with MASKED details only', async () => {
    const fake = makeRegistryFake((c) => {
      if (c.table === 'member_invites' && c.op === 'select') return { data: { id: 7, registrant_id: 'r1', expires_at: '2026-12-31T00:00:00Z', revoked_at: null } };
      if (c.table === 'registrants') return { data: jane };
      return undefined;
    });
    const view = await lookupInvite(fake.client, { now: () => NOW }, 'tok');
    expect(view).toEqual({ inviteId: 7, registrantId: 'r1', maskedEmail: 'j•••@gmail.com', maskedMobile: '04•• ••• 678', eligible: true });
    expect(JSON.stringify(view)).not.toContain('jane@gmail.com');
    expect(fake.where('member_invites', 'update')[0].values).toHaveProperty('last_opened_at');
  });

  it('answers unknown, revoked and expired links identically (null)', async () => {
    for (const row of [null,
      { id: 7, registrant_id: 'r1', expires_at: '2026-12-31T00:00:00Z', revoked_at: '2026-11-01T00:00:00Z' },
      { id: 7, registrant_id: 'r1', expires_at: '2026-11-01T00:00:00Z', revoked_at: null }]) {
      const fake = makeRegistryFake((c) => (c.table === 'member_invites' ? { data: row } : { data: jane }));
      expect(await lookupInvite(fake.client, { now: () => NOW }, 'tok')).toBeNull();
    }
  });

  it('flags a registrant who cannot self-serve', async () => {
    const fake = makeRegistryFake((c) => {
      if (c.table === 'member_invites' && c.op === 'select') return { data: { id: 7, registrant_id: 'r1', expires_at: '2026-12-31T00:00:00Z', revoked_at: null } };
      if (c.table === 'registrants') return { data: { ...jane, phone: null } };
      return undefined;
    });
    expect(await lookupInvite(fake.client, { now: () => NOW }, 'tok')).toMatchObject({ eligible: false, maskedMobile: null });
  });
});

describe('sessions', () => {
  const live = { id: 3, registrant_id: 'r1', last_seen_at: '2026-11-23T09:50:00Z', expires_at: '2027-02-01T00:00:00Z', revoked_at: null };
  const make = (row: unknown) => makeRegistryFake((c) => {
    if (c.table === 'member_sessions' && c.op === 'select') return { data: row };
    if (c.table === 'registrants') return { data: jane };
    return undefined;
  });

  it('finds the signed-in member by the hash of the session id', async () => {
    const fake = make(live);
    expect(await getMemberSession(fake.client, { now: () => NOW }, 'sid')).toEqual({ registrantId: 'r1', firstName: 'Jane' });
    expect(fake.where('member_sessions', 'select')[0].filters).toContainEqual(['eq', ['session_hash', hashToken('sid')]]);
    expect(fake.where('member_sessions', 'update')).toHaveLength(0); // seen 10 min ago — no write
  });

  it('slides the expiry only when the last touch is stale', async () => {
    const fake = make({ ...live, last_seen_at: '2026-11-23T07:00:00Z' });
    await getMemberSession(fake.client, { now: () => NOW }, 'sid');
    expect(fake.where('member_sessions', 'update')[0].values).toMatchObject({ last_seen_at: NOW.toISOString() });
  });

  it('rejects unknown, revoked and expired sessions', async () => {
    for (const row of [null, { ...live, revoked_at: '2026-11-22T00:00:00Z' }, { ...live, expires_at: '2026-11-01T00:00:00Z' }]) {
      expect(await getMemberSession(make(row).client, { now: () => NOW }, 'sid')).toBeNull();
    }
  });

  it('signs out one device, or all of them', async () => {
    const one = makeRegistryFake(() => undefined);
    await revokeMemberSession(one.client, { now: () => NOW }, 'sid');
    expect(one.where('member_sessions', 'update')[0].filters).toContainEqual(['eq', ['session_hash', hashToken('sid')]]);

    const all = makeRegistryFake(() => undefined);
    await revokeAllMemberSessions(all.client, { now: () => NOW }, 'r1');
    expect(all.where('member_sessions', 'update')[0].filters).toContainEqual(['eq', ['registrant_id', 'r1']]);
    expect(all.where('member_auth_events', 'insert')[0].values).toMatchObject({ event: 'session_revoked' });
  });
});
