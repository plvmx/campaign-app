// WhatsApp invite email — decision logic + content, kept pure/framework-
// free so it's testable without Deno or a real Resend call (the actual
// HTTP send lives in ac-sync/emailClient.ts; the "should we send at all"
// call happens in transform.ts).
//
// Scoped deliberately small: a single national WhatsApp group invite link
// (registry.whatsapp_group_links, group_key = NATIONAL_GROUP_KEY below),
// not the state/city-level structure docs/registry-pipeline/
// AFJ_PII_Technical_Implementation_Plan.md Section 8 originally sketched.
// That fuller structure needed a leadership decision on WhatsApp's
// "Communities" feature that was never resolved (~100 real groups exceed
// its published limits); Peter's call (2026-09) was to skip that decision
// entirely — this doesn't use the Communities feature at all, just a
// plain invite link to one existing group, sent by ordinary email. The
// `whatsapp_group_links` table already carries `group_level` so
// state/city links can be added later without a schema change.

/** The only group_key this pipeline sends invites for today — see the file header. */
export const NATIONAL_GROUP_KEY = 'national';

export interface WhatsAppInviteEmailContent {
  subject: string;
  html: string;
  text: string;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * True only for a genuinely new registrant with a usable email address —
 * an existing registrant being re-synced (isNew: false) never gets a
 * repeat invite, and there's nowhere to send one without an email.
 */
export function shouldSendWhatsAppInvite(input: { isNew: boolean; email: string | null }): input is { isNew: true; email: string } {
  return input.isNew && !!input.email;
}

/**
 * Builds the invite email's subject/html/text — a registrant with no first
 * name on file gets a generic greeting rather than "Hi null".
 *
 * `campaignsNearMeUrl` adds a second section pointing to a personalized
 * map of campaigns near the registrant, with one-tap "Yes I'm In"/"Tell Me
 * More" (app/public/campaigns-near-me) — omitted entirely when null (no
 * NEXT_PUBLIC_SITE_URL configured in the sending environment; see
 * ac-sync/emailClient.ts, which builds this URL), so the email never links
 * to a broken/localhost address.
 */
export function buildWhatsAppInviteEmail(firstName: string | null, inviteUrl: string, campaignsNearMeUrl: string | null): WhatsAppInviteEmailContent {
  const name = firstName?.trim() || 'there';
  const safeName = escapeHtml(name);
  const safeUrl = escapeHtml(inviteUrl);

  const subject = "You're invited: join the AFJ WhatsApp group";

  const textLines = [
    `Hi ${name},`,
    '',
    "Welcome to Australia For Jesus! Here's your invite to our national WhatsApp group:",
    inviteUrl,
    '',
    "An admin approves new members before you're added, so it may take a little while to come through.",
  ];
  const htmlLines = [
    `<p>Hi ${safeName},</p>`,
    `<p>Welcome to Australia For Jesus! Here&#39;s your invite to our national WhatsApp group:</p>`,
    `<p><a href="${safeUrl}">${safeUrl}</a></p>`,
    `<p>An admin approves new members before you&#39;re added, so it may take a little while to come through.</p>`,
  ];

  if (campaignsNearMeUrl) {
    const safeMapUrl = escapeHtml(campaignsNearMeUrl);
    textLines.push(
      '',
      'Want to get involved sooner? See campaigns happening near you in the next 7 days, and register your interest with one tap:',
      campaignsNearMeUrl,
    );
    htmlLines.push(
      `<p>Want to get involved sooner? See campaigns happening near you in the next 7 days, and register your interest with one tap:</p>`,
      `<p><a href="${safeMapUrl}">${safeMapUrl}</a></p>`,
    );
  }

  textLines.push('', 'God bless,', 'The AFJ Team');
  htmlLines.push(`<p>God bless,<br/>The AFJ Team</p>`);

  return { subject, text: textLines.join('\n'), html: htmlLines.join('\n') };
}
