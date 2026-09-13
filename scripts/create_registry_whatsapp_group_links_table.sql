-- WhatsApp group invite links for the automated new-registrant invite
-- email (see lib/registryPipeline/whatsappInvite.ts + ac-sync/emailClient.ts).
--
-- Scope decision (2026-09-13, per Peter): the original plan
-- (AFJ_PII_Technical_Implementation_Plan.md Section 8) was blocked on a
-- leadership decision about WhatsApp's "Communities" feature, whose
-- published scale limits AFJ's real footprint (~100 groups, 9,000+
-- subscribers) exceeds. Sidestepped that decision entirely: this doesn't
-- use the Communities feature at all, just an ordinary WhatsApp group's
-- own invite link (the kind any group already has, no scale limit
-- applies to how many separate groups an org can run). Scoped to a
-- single national group for now — group_key/group_level are still kept
-- generic (matching the plan's original design) so state/city links can
-- be added later without a schema change, if that's ever wanted.
--
-- Run this in the Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS registry.whatsapp_group_links (
  group_key    TEXT PRIMARY KEY,   -- 'national' today (lib/registryPipeline/whatsappInvite.ts's NATIONAL_GROUP_KEY); a state code or state+city key if this is ever extended
  group_level  TEXT NOT NULL CHECK (group_level IN ('national', 'state', 'city')),
  invite_url   TEXT NOT NULL,      -- the group's own https://chat.whatsapp.com/... invite link
  updated_at   TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

COMMENT ON TABLE registry.whatsapp_group_links IS 'Invite link(s) sent by the WhatsApp-invite email on a new registration (lib/registryPipeline/whatsappInvite.ts). Update invite_url here (and updated_at) whenever a group''s invite link is reset in WhatsApp — this table is the only place that value lives.';

ALTER TABLE registry.whatsapp_group_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON registry.whatsapp_group_links FROM anon, authenticated;

-- After running the above, add the real national group's invite link —
-- replace the placeholder URL with the actual one from WhatsApp (Group
-- Settings -> Invite via link), then run:
--
-- INSERT INTO registry.whatsapp_group_links (group_key, group_level, invite_url)
-- VALUES ('national', 'national', 'https://chat.whatsapp.com/REPLACE_ME')
-- ON CONFLICT (group_key) DO UPDATE SET invite_url = EXCLUDED.invite_url, updated_at = now();
--
-- No invite is sent at all until this row exists — transform.ts's
-- shouldSendWhatsAppInvite() check is skipped entirely when
-- getWhatsAppGroupLink('national') returns null, so it's safe to run the
-- CREATE TABLE above well ahead of having a real link ready.
