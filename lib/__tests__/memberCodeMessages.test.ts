import { describe, it, expect } from 'vitest';
import { buildMemberCodeEmail, buildMemberSmsBody } from '../memberCodeMessages';

describe('sign-in messages', () => {
  it('the text says what the code is for, that it expires, and not to share it', () => {
    const sms = buildMemberSmsBody('123456');
    expect(sms).toContain('123456');
    expect(sms).toMatch(/expires in 10 minutes/);
    expect(sms).toMatch(/don't share/i);
  });
  it('the email carries the code in both parts and goes only to the given address', () => {
    const email = buildMemberCodeEmail('jane@gmail.com', 'Jane', '654321');
    expect(email.to).toEqual(['jane@gmail.com']);
    expect(email.text).toContain('654321');
    expect(email.html).toContain('654321');
    expect(email.text).toContain('Hi Jane,');
  });
  it('escapes a hostile first name and copes with none', () => {
    expect(buildMemberCodeEmail('a@b.com', '<script>x</script>', '111111').html).not.toContain('<script>');
    expect(buildMemberCodeEmail('a@b.com', null, '111111').text).toContain('Hello,');
  });
  it('never mentions verification jargon', () => {
    const all = JSON.stringify([buildMemberSmsBody('1'), buildMemberCodeEmail('a@b.com', 'A', '1')]);
    expect(all).not.toMatch(/2fa|mfa|authenticator|two-factor|token/i);
  });
});
