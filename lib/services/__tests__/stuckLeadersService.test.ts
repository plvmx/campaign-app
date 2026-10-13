import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { makeQueryBuilder } from './supabaseMock';
import { classifyStuckLeaders, getStuckLeaders, type AuthEmailInfo, type LeaderRow } from '../stuckLeadersService';

vi.mock('@/lib/supabaseClient', () => ({ supabase: { auth: {}, from: vi.fn() } }));

const row = (over: Partial<LeaderRow> = {}): LeaderRow => ({
  id: 'r1', leader: 'Jack', state: 'NSW', admin: null, mobile: '0400 111 222',
  email: null, pending_email: null, email_confirmed_at: null, mfa_enrolled_at: null, user_id: null, last_sign_in_at: null,
  ...over,
});
const auth = (entries: Record<string, Partial<AuthEmailInfo>>) =>
  new Map(Object.entries(entries).map(([k, v]) => [k, { emailSentAt: null, lastUsedAt: null, ...v }]));
const stageOf = (rows: LeaderRow[], a = new Map<string, AuthEmailInfo>()) => classifyStuckLeaders(rows, a).map((l) => l.stage);

describe('classifyStuckLeaders — who is listed', () => {
  it('skips anyone who has finished 2FA', () => {
    expect(stageOf([row({ email: 'a@x.com', mfa_enrolled_at: '2026-10-01T00:00:00Z' })])).toEqual([]);
  });

  it('skips a person if ANY of their rows is enrolled (it is the person who is done)', () => {
    expect(stageOf([row({ id: 'a' }), row({ id: 'b', mfa_enrolled_at: '2026-10-01T00:00:00Z' })])).toEqual([]);
  });

  it('lists an admin who has not started (they cannot sign in as admin without 2FA)', () => {
    expect(stageOf([row({ leader: 'Sam_AD', admin: 'AD' })])).toEqual(['not-started']);
  });

  it('does NOT list a plain leader who has not started (2FA is optional for them)', () => {
    expect(stageOf([row()])).toEqual([]);
  });

  it('does NOT list a plain leader whose email is fine and who never started 2FA', () => {
    expect(stageOf([row({ email: 'a@x.com', email_confirmed_at: '2026-10-01T00:00:00Z' })])).toEqual([]);
  });

  it('lists a state reporter like any admin', () => {
    expect(classifyStuckLeaders([row({ admin: 'SR', leader: 'Pat_SR' })], new Map())[0]).toMatchObject({ role: 'State Reporter', isAdmin: true });
  });
});

describe('classifyStuckLeaders — email confirmation stages', () => {
  const pending = row({ pending_email: 'Jack@Example.com' });

  it('email entered but nothing recorded as sent', () => {
    expect(stageOf([pending])).toEqual(['email-not-sent']);
  });

  it('confirmation email sent, link never used', () => {
    expect(stageOf([pending], auth({ 'jack@example.com': { emailSentAt: '2026-10-12T01:00:00Z' } }))).toEqual(['email-link-unused']);
  });

  it('link used after the last send but the email never got confirmed', () => {
    expect(
      stageOf([pending], auth({ 'jack@example.com': { emailSentAt: '2026-10-12T01:00:00Z', lastUsedAt: '2026-10-12T01:05:00Z' } })),
    ).toEqual(['email-link-used']);
  });

  it('a link used BEFORE the latest email was sent counts as unused (the newest email is what matters)', () => {
    expect(
      stageOf([pending], auth({ 'jack@example.com': { emailSentAt: '2026-10-12T03:00:00Z', lastUsedAt: '2026-10-12T01:05:00Z' } })),
    ).toEqual(['email-link-unused']);
  });

  it('matches the email account case-insensitively', () => {
    expect(stageOf([pending], auth({ 'jack@example.com': { emailSentAt: '2026-10-12T01:00:00Z' } }))).not.toEqual(['email-not-sent']);
  });
});

describe('classifyStuckLeaders — 2FA setup stages', () => {
  const confirmed = row({ email: 'jack@example.com', email_confirmed_at: '2026-10-12T02:00:00Z', admin: 'AD', leader: 'Jack_AD' });

  it('the confirmation email itself (sent before confirmation) is not mistaken for a 2FA setup email', () => {
    expect(stageOf([confirmed], auth({ 'jack@example.com': { emailSentAt: '2026-10-12T01:59:00Z', lastUsedAt: '2026-10-12T02:00:00Z' } })))
      .toEqual(['2fa-not-started']);
  });

  it('2FA setup email sent after confirmation, link not used', () => {
    expect(stageOf([confirmed], auth({ 'jack@example.com': { emailSentAt: '2026-10-12T03:00:00Z', lastUsedAt: '2026-10-12T02:00:00Z' } })))
      .toEqual(['2fa-link-unused']);
  });

  it('2FA link used but setup never finished', () => {
    expect(stageOf([confirmed], auth({ 'jack@example.com': { emailSentAt: '2026-10-12T03:00:00Z', lastUsedAt: '2026-10-12T03:01:00Z' } })))
      .toEqual(['2fa-started']);
  });

  it('an admin-entered email (counts as confirmed, no confirmation timestamp) with a sent email is a 2FA setup email', () => {
    const adminEntered = row({ email: 'sam@example.com', admin: 'AD', leader: 'Sam_AD' });
    expect(stageOf([adminEntered], auth({ 'sam@example.com': { emailSentAt: '2026-10-12T03:00:00Z' } }))).toEqual(['2fa-link-unused']);
  });

  it('a plain leader who started 2FA but did not finish IS listed', () => {
    const plain = row({ email: 'jack@example.com', email_confirmed_at: '2026-10-12T02:00:00Z' });
    expect(stageOf([plain], auth({ 'jack@example.com': { emailSentAt: '2026-10-12T03:00:00Z', lastUsedAt: '2026-10-12T03:01:00Z' } }))).toEqual(['2fa-started']);
  });
});

describe('classifyStuckLeaders — one entry per person, ordering', () => {
  it('collapses several rows sharing a mobile into one person, named after their admin row', () => {
    const rows = [
      row({ id: '1', leader: 'Lorraine', state: 'NSW', mobile: '0400 111 222' }),
      row({ id: '2', leader: 'Lorraine', state: 'WA', mobile: '0400111222' }),
      row({ id: '3', leader: 'Lorraine_AD', state: 'WA', admin: 'AD', mobile: '+61 400 111 222' }),
    ];
    const result = classifyStuckLeaders(rows, new Map());
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ name: 'Lorraine_AD', role: 'Admin', states: ['NSW', 'WA'] });
  });

  it('lists admins before plain leaders, then the most recently active first', () => {
    const a = new Map<string, AuthEmailInfo>([
      ['p1@x.com', { emailSentAt: '2026-10-10T00:00:00Z', lastUsedAt: null }],
      ['p2@x.com', { emailSentAt: '2026-10-12T00:00:00Z', lastUsedAt: null }],
    ]);
    const rows = [
      row({ id: '1', leader: 'Older', mobile: '0411', pending_email: 'p1@x.com' }),
      row({ id: '2', leader: 'Newer', mobile: '0422', pending_email: 'p2@x.com' }),
      row({ id: '3', leader: 'Sam_AD', mobile: '0433', admin: 'AD' }),
    ];
    expect(classifyStuckLeaders(rows, a).map((l) => l.name)).toEqual(['Sam_AD', 'Newer', 'Older']);
  });
});

describe('getStuckLeaders', () => {
  it('combines the leader rows with the email accounts (ignoring anonymous sessions)', async () => {
    const builder = makeQueryBuilder({ data: [row({ pending_email: 'jack@example.com' })], error: null });
    const listUsers = vi.fn().mockResolvedValue({
      data: {
        users: [
          { email: 'jack@example.com', is_anonymous: false, recovery_sent_at: '2026-10-12T01:00:00Z', confirmation_sent_at: null, last_sign_in_at: null },
          { email: 'jack@example.com', is_anonymous: true, recovery_sent_at: '2026-10-12T09:00:00Z', confirmation_sent_at: null, last_sign_in_at: '2026-10-12T09:01:00Z' },
        ],
      },
      error: null,
    });
    const client = { from: vi.fn(() => builder), auth: { admin: { listUsers } } } as unknown as SupabaseClient;

    const result = await getStuckLeaders(client);

    expect(result).toHaveLength(1);
    expect(result[0].stage).toBe('email-link-unused');
  });

  it('throws when the leaders cannot be read rather than reporting nobody is stuck', async () => {
    const client = {
      from: vi.fn(() => makeQueryBuilder({ data: null, error: { message: 'boom' } })),
      auth: { admin: { listUsers: vi.fn() } },
    } as unknown as SupabaseClient;
    await expect(getStuckLeaders(client)).rejects.toEqual({ message: 'boom' });
  });
});
