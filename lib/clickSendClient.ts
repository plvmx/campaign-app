/**
 * ClickSend SMS adapter for the "text the leader" notification
 * (lib/services/campaignInterestSmsService.ts) — thin wiring only, same role
 * as supabase/functions/ac-sync/emailClient.ts for Resend.
 *
 * Requires CLICKSEND_USERNAME and CLICKSEND_API_KEY (see README.md).
 * Always throws on failure to send — including missing config — rather than
 * swallowing it, so the single try/catch in campaignInterestSmsService.ts is
 * the one place responsible for logging every outcome to
 * campaign_interest_sms_log. A silently-swallowed failure here is exactly
 * the mistake registry.whatsapp_invite_log's own EmailPort used to make
 * before being fixed to always throw — see that file's comment.
 */

const CLICKSEND_SEND_URL = 'https://rest.clicksend.com/v3/sms/send';

export async function sendSms(toE164: string, body: string): Promise<{ messageId: string | null }> {
  const username = process.env.CLICKSEND_USERNAME;
  const apiKey = process.env.CLICKSEND_API_KEY;
  if (!username || !apiKey) {
    throw new Error('CLICKSEND_USERNAME/CLICKSEND_API_KEY is not set');
  }

  const res = await fetch(CLICKSEND_SEND_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${username}:${apiKey}`).toString('base64')}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ messages: [{ source: 'campaign-app', to: toE164, body }] }),
  });

  const payload: unknown = await res.json().catch(() => null);

  if (!res.ok) {
    const message = payload && typeof payload === 'object' && 'response_msg' in payload
      ? String((payload as { response_msg: unknown }).response_msg)
      : `ClickSend request failed with status ${res.status}`;
    throw new Error(message);
  }

  const messageStatus = (payload as { data?: { messages?: { status?: string; message_id?: string }[] } } | null)
    ?.data?.messages?.[0];
  if (messageStatus?.status && messageStatus.status !== 'SUCCESS') {
    throw new Error(`ClickSend rejected the message: ${messageStatus.status}`);
  }

  return { messageId: messageStatus?.message_id ?? null };
}
