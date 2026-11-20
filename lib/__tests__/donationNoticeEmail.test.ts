import { describe, it, expect } from 'vitest';
import { buildDonationNoticeEmail, buildDonationNoticeRows } from '../donationNoticeEmail';

describe('buildDonationNoticeRows', () => {
  it('shows "Not provided" for an absent email or amount', () => {
    expect(buildDonationNoticeRows({ name: 'Mary', email: null, amount: null })).toEqual([
      { label: 'Name', value: 'Mary' },
      { label: 'Email', value: 'Not provided' },
      { label: 'Amount', value: 'Not provided' },
    ]);
  });

  it('formats a provided amount with a dollar sign', () => {
    expect(buildDonationNoticeRows({ name: 'Mary', email: 'mary@example.com', amount: '50.50' })).toEqual([
      { label: 'Name', value: 'Mary' },
      { label: 'Email', value: 'mary@example.com' },
      { label: 'Amount', value: '$50.50' },
    ]);
  });
});

describe('buildDonationNoticeEmail', () => {
  it('builds a subject naming the donor and html/text bodies with every row', () => {
    const email = buildDonationNoticeEmail({ name: 'Mary <Smith>', email: 'mary@example.com', amount: '50' });
    expect(email.subject).toBe('Bank Transfer Donation Notice — Mary <Smith>');
    expect(email.text).toContain('Name: Mary <Smith>');
    expect(email.text).toContain('Amount: $50');
    expect(email.html).toContain('Mary &lt;Smith&gt;');
  });
});
