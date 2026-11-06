/**
 * Resend adapter for emails sent from the Next.js app (the registry Edge
 * Function has its own in supabase/functions/ac-sync/emailClient.ts).
 *
 * Requires RESEND_API_KEY; the sender defaults to AFJ's address and can be
 * overridden with CAMPAIGN_REPORT_EMAIL_FROM — it must be on a domain verified
 * in Resend. Always throws on failure, including missing config, so callers
 * decide what to show (never a silent success).
 */

const RESEND_API_URL = 'https://api.resend.com/emails';
export const DEFAULT_EMAIL_FROM = 'AFJ <noreply@afj.org.au>';

export interface OutgoingEmail { to: string[]; subject: string; html: string; text: string }

export async function sendEmail(
  email: OutgoingEmail,
  fetchImpl: typeof fetch = fetch,
): Promise<{ messageId: string | null }> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error('RESEND_API_KEY is not set');

  const res = await fetchImpl(RESEND_API_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: process.env.CAMPAIGN_REPORT_EMAIL_FROM || DEFAULT_EMAIL_FROM,
      to: email.to,
      subject: email.subject,
      html: email.html,
      text: email.text,
    }),
  });

  const payload: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const message = payload && typeof payload === 'object' && 'message' in payload
      ? String((payload as { message: unknown }).message)
      : `Resend request failed with status ${res.status}`;
    throw new Error(message);
  }
  const id = payload && typeof payload === 'object' && 'id' in payload ? String((payload as { id: unknown }).id) : null;
  return { messageId: id };
}
