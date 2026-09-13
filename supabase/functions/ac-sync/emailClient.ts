// Resend adapter for the WhatsApp invite email — implements
// lib/registryPipeline/ports.ts's EmailPort. See
// lib/registryPipeline/whatsappInvite.ts for the actual email content and
// the "should we even send" decision; this file is thin wiring only, same
// role as acClient.ts/db.ts for their own external systems.
//
// Requires RESEND_API_KEY as an Edge Function secret
// (`supabase secrets set RESEND_API_KEY=...`) — reuses the AFJ Resend
// account already configured as Supabase Auth's custom SMTP provider for
// magic-link emails, but that's a Supabase Dashboard setting, not
// something this codebase can read; this calls Resend's own HTTP API
// directly, so it needs its own API key value here regardless.
//
// Deliberately never throws on a missing key or a failed send — this
// email is a best-effort side effect of a sync that must keep working
// even if Resend is misconfigured or briefly down (see transform.ts's
// call site, which also wraps this in its own try/catch as a second line
// of defense). A missing key logs once per call rather than failing
// Edge Function startup, so ac-sync's actual job (landing registrants)
// is never put at risk by this newer, additive feature.

import { getErrorMessage } from '../../../lib/errorUtils.ts';
import type { EmailPort } from '../../../lib/registryPipeline/ports.ts';
import { buildWhatsAppInviteEmail } from '../../../lib/registryPipeline/whatsappInvite.ts';

const RESEND_API_URL = 'https://api.resend.com/emails';

// Must be a verified sending address on the Resend account/domain in use —
// update if AFJ's verified sending domain differs from this placeholder.
const FROM_ADDRESS = 'AFJ <noreply@afj.org.au>';

export function createEmailClient(): EmailPort {
  return {
    async sendWhatsAppInviteEmail({ to, firstName, inviteUrl }) {
      const apiKey = Deno.env.get('RESEND_API_KEY');
      if (!apiKey) {
        console.error('[ac-sync] RESEND_API_KEY is not set — skipping WhatsApp invite email');
        return;
      }

      const { subject, html, text } = buildWhatsAppInviteEmail(firstName, inviteUrl);

      try {
        const res = await fetch(RESEND_API_URL, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ from: FROM_ADDRESS, to: [to], subject, html, text }),
        });
        if (!res.ok) {
          const body = await res.text();
          throw new Error(`Resend API error ${res.status}: ${body}`);
        }
      } catch (err) {
        // Re-thrown rather than swallowed here — transform.ts's own
        // try/catch around this call is what actually decides this can
        // never fail the underlying sync; keeping the throw here means
        // that safety net stays in exactly one place, not duplicated.
        throw new Error(`sendWhatsAppInviteEmail: ${getErrorMessage(err)}`);
      }
    },
  };
}
