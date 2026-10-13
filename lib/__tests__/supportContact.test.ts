import { describe, it, expect } from 'vitest';
import { buildHelpMessage, getSupportSmsHref, toSupportNumber } from '../supportContact';

describe('toSupportNumber', () => {
  it('turns an Australian mobile into +61 form', () => {
    expect(toSupportNumber('0429 028 464')).toBe('+61429028464');
    expect(toSupportNumber('0429-028-464')).toBe('+61429028464');
  });
  it('keeps numbers already in international form', () => {
    expect(toSupportNumber('+61 429 028 464')).toBe('+61429028464');
    expect(toSupportNumber('61429028464')).toBe('+61429028464');
  });
  it('returns null for nothing usable', () => {
    expect(toSupportNumber(undefined)).toBeNull();
    expect(toSupportNumber('')).toBeNull();
    expect(toSupportNumber('abc')).toBeNull();
    expect(toSupportNumber('123')).toBeNull();
  });
});

describe('buildHelpMessage', () => {
  it('names the step and the person', () => {
    expect(buildHelpMessage('typing the code from my app', 'Jack (NSW)')).toBe(
      "Hi, I need help with my AFJ app sign-in setup. I'm Jack (NSW). I'm stuck at: typing the code from my app.",
    );
  });
  it('works without a name', () => {
    expect(buildHelpMessage('confirming my email')).toBe('Hi, I need help with my AFJ app sign-in setup. I\'m stuck at: confirming my email.');
  });
});

describe('getSupportSmsHref', () => {
  it('builds an sms: link with the encoded message', () => {
    const href = getSupportSmsHref('Hi there & thanks', '0429028464');
    expect(href).toBe(`sms:+61429028464?&body=${encodeURIComponent('Hi there & thanks')}`);
  });
  it('is null when no number is configured', () => {
    expect(getSupportSmsHref('hi', undefined)).toBeNull();
    expect(getSupportSmsHref('hi', '')).toBeNull();
  });
});
