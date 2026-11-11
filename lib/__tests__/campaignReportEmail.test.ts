import { describe, it, expect } from 'vitest';
import { buildCampaignReportEmail } from '../campaignReportEmail';

const input = {
  location: 'Sylvania NSW',
  leader: 'Marie H',
  date: '30/09/2024',
  counts: { partial: 0, full: 5, sinnersPrayers: 5, followUp: 2 },
};

describe('buildCampaignReportEmail', () => {
  it('has the title, subject and every report field in html and text', () => {
    const { subject, html, text } = buildCampaignReportEmail(input);
    expect(subject).toBe('TWOL Campaign Report — Sylvania NSW — 30/09/2024');
    for (const body of [html, text]) {
      expect(body).toContain('TWOL Campaign Report');
      expect(body).toContain('Campaign Leader');
      expect(body).toContain('Marie H');
      expect(body).toContain('Number of Partial Presentations');
      expect(body).toContain('Number of Full Presentations');
      expect(body).toContain('Number of Sinners Prayers');
      expect(body).toContain('Number of Requests for Follow-up/Info');
    }
    expect(text).toContain('Number of Full Presentations: 5');
    expect(text).toContain('Number of Requests for Follow-up/Info: 2');
  });

  it('leaves out the variant and the page URL', () => {
    const { html, text } = buildCampaignReportEmail(input);
    for (const body of [html, text]) {
      expect(body).not.toMatch(/variant/i);
      expect(body).not.toMatch(/https?:\/\//);
    }
  });

  it('escapes html in free-text fields', () => {
    const { html } = buildCampaignReportEmail({ ...input, leader: '<script>alert(1)</script> & "Co"' });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;Co&quot;');
  });
});
