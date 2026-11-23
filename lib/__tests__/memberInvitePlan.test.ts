import { describe, it, expect } from 'vitest';
import { buildInviteLink, parseEmailList, planMemberInvites, type RegistrantForInvite } from '../memberInvitePlan';

const reg = (over: Partial<RegistrantForInvite> = {}): RegistrantForInvite => ({
  id: 'r1', first_name: 'Jane', email: 'jane@gmail.com', phone: '+61412345678', unsubscribed: null, nfc: null, ...over,
});
const plan = (emails: string[], registrants: RegistrantForInvite[], liveInviteCounts: Record<string, number> = {}, replace = false) =>
  planMemberInvites({ emails, registrants, liveInviteCounts, replace });

describe('parseEmailList', () => {
  it('splits on commas, spaces and semicolons, lower-cases and de-duplicates', () => {
    expect(parseEmailList('Jane@Gmail.com, bob@x.org;jane@gmail.com  sue@y.com')).toEqual(['jane@gmail.com', 'bob@x.org', 'sue@y.com']);
  });
  it('refuses an empty list or an invalid address (naming it)', () => {
    expect(() => parseEmailList('  ')).toThrow(/No email/);
    expect(() => parseEmailList('jane@gmail.com, nope')).toThrow(/nope/);
  });
});

describe('planMemberInvites', () => {
  it('creates an invite for an eligible registrant', () => {
    expect(plan(['jane@gmail.com'], [reg()])).toEqual([
      { email: 'jane@gmail.com', status: 'create', registrantId: 'r1', firstName: 'Jane', notes: [], existing: 0 },
    ]);
  });
  it('matches the registrant case-insensitively', () => {
    expect(plan(['jane@gmail.com'], [reg({ email: 'Jane@Gmail.com' })])[0].status).toBe('create');
  });
  it('reports an unknown email as not found', () => {
    expect(plan(['who@x.com'], [reg()])).toEqual([{ email: 'who@x.com', status: 'not_found' }]);
  });
  it('refuses someone who could not sign in anyway, saying why', () => {
    expect(plan(['jane@gmail.com'], [reg({ phone: null })])[0]).toMatchObject({ status: 'ineligible', reason: 'no_mobile' });
    expect(plan(['noemail@noemail.com'], [reg({ email: 'noemail@noemail.com' })])[0]).toMatchObject({ status: 'ineligible', reason: 'no_usable_email' });
  });
  it('skips someone with a live invite unless asked to replace it', () => {
    expect(plan(['jane@gmail.com'], [reg()], { r1: 2 })[0]).toMatchObject({ status: 'skip_existing', existing: 2 });
    expect(plan(['jane@gmail.com'], [reg()], { r1: 2 }, true)[0]).toMatchObject({ status: 'replace', existing: 2 });
  });
  it('still allows unsubscribed / no-further-contact people (they can sign in) but flags them', () => {
    expect(plan(['jane@gmail.com'], [reg({ unsubscribed: 'Yes', nfc: 'Yes' })])[0]).toMatchObject({
      status: 'create', notes: ['unsubscribed', 'no further contact'],
    });
  });
});

describe('buildInviteLink', () => {
  it('builds the sign-in link on the origin only, encoding the token', () => {
    expect(buildInviteLink('https://campaign.afj.org.au/some/path?x=1', 'ab_-12')).toBe('https://campaign.afj.org.au/member/sign-in?i=ab_-12');
    expect(buildInviteLink('http://localhost:3000', 't')).toBe('http://localhost:3000/member/sign-in?i=t');
  });
  it('refuses insecure or malformed bases', () => {
    expect(() => buildInviteLink('http://campaign.afj.org.au', 't')).toThrow(/https/);
    expect(() => buildInviteLink('not a url', 't')).toThrow(/valid base URL/);
  });
});
