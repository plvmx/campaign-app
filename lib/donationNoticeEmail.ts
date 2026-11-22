/**
 * Builds the management email sent when a bank-transfer donor uses the
 * optional "let us know you're transferring" notice on /public/donate.
 * Pure, so the content is unit tested without any network. Table layout
 * with inline styles because email clients ignore stylesheets.
 */
export const DONATION_NOTICE_EMAIL_TITLE = 'Bank Transfer Donation Notice';

export interface DonationNoticeEmailInput {
  name: string;
  email: string | null;
  amount: string | null;
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

/** The label/value lines shared by the management email. */
export function buildDonationNoticeRows(input: DonationNoticeEmailInput): { label: string; value: string }[] {
  return [
    { label: 'Name', value: input.name },
    { label: 'Email', value: input.email || 'Not provided' },
    { label: 'Amount', value: input.amount ? `$${input.amount}` : 'Not provided' },
  ];
}

export function buildDonationNoticeEmail(input: DonationNoticeEmailInput): BuiltEmail {
  const rows = buildDonationNoticeRows(input);

  const rowHtml = rows
    .map(
      ({ label, value }) => `
          <tr>
            <td style="padding:14px 20px;border-top:1px solid #e5e7eb;font-size:16px;font-weight:bold;color:#374151;width:35%;">${escapeHtml(label)}</td>
            <td style="padding:14px 20px;border-top:1px solid #e5e7eb;font-size:16px;color:#111827;">${escapeHtml(value)}</td>
          </tr>`,
    )
    .join('');

  const html = `<!DOCTYPE html>
<html>
  <body style="margin:0;padding:24px 12px;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:8px;overflow:hidden;">
      <tr>
        <td style="background:#1d4ed8;padding:24px 20px;">
          <h1 style="margin:0;font-size:24px;color:#ffffff;">${DONATION_NOTICE_EMAIL_TITLE}</h1>
        </td>
      </tr>
      <tr>
        <td style="padding:20px 20px 8px;font-size:16px;color:#374151;">Someone has let us know they're making a direct bank transfer donation.</td>
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
    DONATION_NOTICE_EMAIL_TITLE,
    '',
    "Someone has let us know they're making a direct bank transfer donation.",
    '',
    ...rows.map(({ label, value }) => `${label}: ${value}`),
    '',
    'Sent automatically by the TWOL Campaign Activity System.',
  ].join('\n');

  return { subject: `${DONATION_NOTICE_EMAIL_TITLE} — ${input.name}`, html, text };
}
