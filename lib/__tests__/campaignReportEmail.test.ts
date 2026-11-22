import { describe, it, expect } from 'vitest';
import { buildCampaignReportEmail, buildCampaignReportRows, CAMPAIGN_REPORT_SUMMARY_TITLE } from '../campaignReportEmail';

const input = {
  location: 'Sylvania NSW',
  leader: 'Marie H',
  teamSize: 1,
  date: '30/09/2024',
  counts: { partial: 0, full: 5, sinnersPrayers: 5, followUp: 2 },
};

describe('buildCampaignReportEmail', () => {
  it('shows the extra team members in brackets after the leader, and nothing for a team of one', () => {
    const two = buildCampaignReportEmail({ ...input, teamSize: 2 });
    expect(two.text).toContain('Campaign Leader: Marie H (+1)');
    expect(two.html).toContain('Marie H (+1)');
    const one = buildCampaignReportEmail({ ...input, teamSize: 1 });
    expect(one.text).toContain('Campaign Leader: Marie H\n');
    expect(one.html).not.toContain('(+');
  });

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

describe('buildCampaignReportRows', () => {
  it('gives the same lines the email shows, in order, with the team size after the leader', () => {
    expect(buildCampaignReportRows({ ...input, teamSize: 2 })).toEqual([
      { label: 'Location', value: 'Sylvania NSW' },
      { label: 'Campaign Leader', value: 'Marie H (+1)' },
      { label: 'Campaign Date', value: '30/09/2024' },
      { label: 'Number of Partial Presentations', value: '0' },
      { label: 'Number of Full Presentations', value: '5' },
      { label: 'Number of Sinners Prayers', value: '5' },
      { label: 'Number of Requests for Follow-up/Info', value: '2' },
    ]);
  });
  it('titles the on-screen summary "TWOL Campaign Summary"', () => {
    expect(CAMPAIGN_REPORT_SUMMARY_TITLE).toBe('TWOL Campaign Summary');
  });
});
