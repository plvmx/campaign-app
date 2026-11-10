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
// Always throws on failure to send — including a missing RESEND_API_KEY —
// rather than swallowing it. This is still a best-effort side effect of a
// sync that must keep working even if Resend is misconfigured or briefly
// down: transform.ts's own try/catch around this call is what actually
// guarantees that (and additionally persists the failure to
// registry.whatsapp_invite_log so it isn't only ever visible here in the
// Edge Function's own console output).

import { getErrorMessage } from '../../../lib/errorUtils.ts';
import type { EmailPort } from '../../../lib/registryPipeline/ports.ts';
import { buildWhatsAppInviteEmail } from '../../../lib/registryPipeline/whatsappInvite.ts';

const RESEND_API_URL = 'https://api.resend.com/emails';

// Must be a verified sending address on the Resend account/domain in use —
// update if AFJ's verified sending domain differs from this placeholder.
const FROM_ADDRESS = 'AFJ <noreply@afj.org.au>';

/**
 * The Next.js app's own public origin, for the personalized
 * "Campaigns Near Me" link included in the invite email
 * (app/public/campaigns-near-me). Deno's environment doesn't carry
 * Vercel's own auto-injected VERCEL_PROJECT_PRODUCTION_URL (this Edge
 * Function isn't deployed on Vercel) the way lib/siteUrl.ts's Node-side
 * equivalent can — NEXT_PUBLIC_SITE_URL must be set explicitly as an Edge
 * Function secret (`supabase secrets set NEXT_PUBLIC_SITE_URL=https://...`)
 * for this link to appear at all. Returns null rather than guessing at a
 * fallback (e.g. localhost), which would silently ship a broken link in a
 * real email — buildWhatsAppInviteEmail() omits the whole section when
 * this is null.
 */
function resolveSiteUrl(): string | null {
  return Deno.env.get('NEXT_PUBLIC_SITE_URL') ?? null;
}

export function createEmailClient(): EmailPort {
  return {
    async sendWhatsAppInviteEmail({ to, firstName, inviteUrl, registrantId }) {
      const apiKey = Deno.env.get('RESEND_API_KEY');
      if (!apiKey) {
        // Thrown, not swallowed — transform.ts's own try/catch around this
        // call is what actually decides this can never fail the
        // underlying sync, and it also persists this as a 'failed' row in
        // registry.whatsapp_invite_log, so a misconfigured key doesn't
        // stay invisible.
        throw new Error('RESEND_API_KEY is not set');
      }

      const siteUrl = resolveSiteUrl();
      const campaignsNearMeUrl = siteUrl ? `${siteUrl}/public/campaigns-near-me?r=${encodeURIComponent(registrantId)}` : null;
      if (!siteUrl) {
        console.error('[ac-sync] NEXT_PUBLIC_SITE_URL is not set — sending WhatsApp invite email without the campaigns-near-me link');
      }

      const { subject, html, text } = buildWhatsAppInviteEmail(firstName, inviteUrl, campaignsNearMeUrl);

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
        const data = await res.json();
        return { resendMessageId: (data as { id?: string }).id ?? '', includedCampaignsNearMeLink: campaignsNearMeUrl !== null };
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
