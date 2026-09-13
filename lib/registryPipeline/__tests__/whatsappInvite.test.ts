import { describe, it, expect } from 'vitest';
import { shouldSendWhatsAppInvite, buildWhatsAppInviteEmail, NATIONAL_GROUP_KEY } from '../whatsappInvite';

describe('NATIONAL_GROUP_KEY', () => {
  it('is a stable, non-empty key', () => {
    expect(NATIONAL_GROUP_KEY).toBe('national');
  });
});

describe('shouldSendWhatsAppInvite', () => {
  it('sends for a genuinely new registrant with an email', () => {
    expect(shouldSendWhatsAppInvite({ isNew: true, email: 'jane@example.com' })).toBe(true);
  });

  it('does not send for an existing registrant being re-synced, even with an email', () => {
    expect(shouldSendWhatsAppInvite({ isNew: false, email: 'jane@example.com' })).toBe(false);
  });

  it('does not send for a new registrant with no email on file', () => {
    expect(shouldSendWhatsAppInvite({ isNew: true, email: null })).toBe(false);
  });

  it('does not send for a new registrant with an empty-string email', () => {
    expect(shouldSendWhatsAppInvite({ isNew: true, email: '' })).toBe(false);
  });
});

describe('buildWhatsAppInviteEmail', () => {
  it('greets the registrant by first name and includes the invite link in both html and text', () => {
    const { subject, html, text } = buildWhatsAppInviteEmail('Jane', 'https://chat.whatsapp.com/abc123', null);
    expect(subject).toMatch(/WhatsApp/);
    expect(text).toContain('Hi Jane,');
    expect(text).toContain('https://chat.whatsapp.com/abc123');
    expect(html).toContain('Hi Jane,');
    expect(html).toContain('href="https://chat.whatsapp.com/abc123"');
  });

  it('falls back to a generic greeting when there is no first name on file', () => {
    const { text, html } = buildWhatsAppInviteEmail(null, 'https://chat.whatsapp.com/abc123', null);
    expect(text).toContain('Hi there,');
    expect(html).toContain('Hi there,');
  });

  it('escapes a first name containing HTML-significant characters', () => {
    const { html } = buildWhatsAppInviteEmail('<script>alert(1)</script>', 'https://chat.whatsapp.com/abc123', null);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('trims a first name that is present but blank/whitespace-only, falling back to the generic greeting', () => {
    const { text } = buildWhatsAppInviteEmail('   ', 'https://chat.whatsapp.com/abc123', null);
    expect(text).toContain('Hi there,');
  });

  it('omits the campaigns-near-me section entirely when no URL is given', () => {
    const { text, html } = buildWhatsAppInviteEmail('Jane', 'https://chat.whatsapp.com/abc123', null);
    expect(text).not.toContain('campaigns happening near you');
    expect(html).not.toContain('campaigns happening near you');
  });

  it('includes a campaigns-near-me section, with the link, when a URL is given', () => {
    const mapUrl = 'https://campaign.afj.org.au/public/campaigns-near-me?r=abc-123';
    const { text, html } = buildWhatsAppInviteEmail('Jane', 'https://chat.whatsapp.com/abc123', mapUrl);
    expect(text).toContain('campaigns happening near you');
    expect(text).toContain(mapUrl);
    expect(html).toContain('campaigns happening near you');
    expect(html).toContain(`href="${mapUrl}"`);
  });

  it('still includes the WhatsApp invite link and sign-off when the campaigns-near-me section is present', () => {
    const { text } = buildWhatsAppInviteEmail('Jane', 'https://chat.whatsapp.com/abc123', 'https://campaign.afj.org.au/public/campaigns-near-me?r=abc-123');
    expect(text).toContain('https://chat.whatsapp.com/abc123');
    expect(text).toContain('The AFJ Team');
  });
});
