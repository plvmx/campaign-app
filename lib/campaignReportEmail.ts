/**
 * Builds the management email for a submitted TWOL Campaign Report: counts
 * only (no names — those are for prayer and stay in the app). Pure, so the
 * content is unit tested without any network. Table layout with inline styles
 * because email clients ignore stylesheets.
 */
import { REPORT_COUNT_FIELDS, type ReportCountField } from './campaignReportEntry';

export const CAMPAIGN_REPORT_EMAIL_TITLE = 'TWOL Campaign Report';

export interface CampaignReportEmailInput {
  location: string;
  leader: string;
  /** dd/mm/yyyy, as on the report form. */
  date: string;
  counts: Record<ReportCountField, number>;
}

export interface BuiltEmail { subject: string; html: string; text: string }

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function buildCampaignReportEmail(input: CampaignReportEmailInput): BuiltEmail {
  const rows: { label: string; value: string }[] = [
    { label: 'Location', value: input.location },
    { label: 'Campaign Leader', value: input.leader },
    { label: 'Campaign Date', value: input.date },
    ...REPORT_COUNT_FIELDS.map(({ key, label }) => ({ label, value: String(input.counts[key]) })),
  ];

  const rowHtml = rows
    .map(
      ({ label, value }) => `
          <tr>
            <td style="padding:14px 20px;border-top:1px solid #e5e7eb;font-size:16px;font-weight:bold;color:#374151;width:55%;">${escapeHtml(label)}</td>
            <td style="padding:14px 20px;border-top:1px solid #e5e7eb;font-size:16px;color:#111827;text-align:right;">${escapeHtml(value)}</td>
          </tr>`,
    )
    .join('');

  const html = `<!DOCTYPE html>
<html>
  <body style="margin:0;padding:24px 12px;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:8px;overflow:hidden;">
      <tr>
        <td style="background:#1d4ed8;padding:24px 20px;">
          <h1 style="margin:0;font-size:24px;color:#ffffff;">${CAMPAIGN_REPORT_EMAIL_TITLE}</h1>
        </td>
      </tr>
      <tr>
        <td style="padding:20px 20px 8px;font-size:16px;color:#374151;">A new campaign report has been submitted.</td>
      </tr>
      <tr>
        <td>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rowHtml}
          </table>
        </td>
      </tr>
      <tr>
        <td style="padding:16px 20px;border-top:1px solid #e5e7eb;font-size:13px;color:#6b7280;">Sent automatically by the TWOL Campaign Activity System.</td>
      </tr>
    </table>
  </body>
</html>`;

  const text = [
    CAMPAIGN_REPORT_EMAIL_TITLE,
    '',
    'A new campaign report has been submitted.',
    '',
    ...rows.map(({ label, value }) => `${label}: ${value}`),
    '',
    'Sent automatically by the TWOL Campaign Activity System.',
  ].join('\n');

  return { subject: `${CAMPAIGN_REPORT_EMAIL_TITLE} — ${input.location} — ${input.date}`, html, text };
}
