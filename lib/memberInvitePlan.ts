/**
 * Planning for scripts/create_member_invite.ts — which registrants get a member
 * portal sign-in link, and which are skipped and why. Pure (no database, no
 * crypto) so the decisions are unit tested; the script only does the I/O.
 * See docs/member-portal/SIGN_IN_DESIGN.md §4.
 */
import { isValidEmail } from './emailFormat';
import { isEligibleForSignIn, isPlaceholderEmail } from './services/memberAuthService';

export interface RegistrantForInvite {
  id: string;
  first_name: string | null;
  email: string | null;
  phone: string | null;
  unsubscribed: string | null;
  nfc: string | null;
}

export type InvitePlanEntry =
  | { email: string; status: 'create' | 'replace'; registrantId: string; firstName: string | null; notes: string[]; existing: number }
  | { email: string; status: 'skip_existing'; registrantId: string; existing: number }
  | { email: string; status: 'not_found' }
  | { email: string; status: 'ineligible'; registrantId: string; reason: 'no_mobile' | 'no_usable_email' };

/** "a@x.com, B@y.com" → ["a@x.com", "b@y.com"]; throws naming the first invalid address. */
export function parseEmailList(raw: string): string[] {
  const emails = [...new Set(raw.split(/[\s,;]+/).map((e) => e.trim().toLowerCase()).filter(Boolean))];
  if (emails.length === 0) throw new Error('No email addresses given.');
  const bad = emails.find((e) => !isValidEmail(e));
  if (bad) throw new Error(`Not a valid email address: ${bad}`);
  return emails;
}

export function planMemberInvites(input: {
  emails: string[];
  registrants: RegistrantForInvite[];
  /** How many unrevoked, unexpired invites each registrant already has. */
  liveInviteCounts: Record<string, number>;
  /** Revoke existing invites and issue a fresh one instead of skipping. */
  replace: boolean;
}): InvitePlanEntry[] {
  const byEmail = new Map(input.registrants.filter((r) => r.email).map((r) => [(r.email as string).toLowerCase(), r]));
  return input.emails.map((email): InvitePlanEntry => {
    const r = byEmail.get(email);
    if (!r) return { email, status: 'not_found' };
    if (!isEligibleForSignIn(r)) {
      const usableEmail = !!r.email && isValidEmail(r.email) && !isPlaceholderEmail(r.email);
      return { email, status: 'ineligible', registrantId: r.id, reason: usableEmail ? 'no_mobile' : 'no_usable_email' };
    }
    const existing = input.liveInviteCounts[r.id] ?? 0;
    if (existing > 0 && !input.replace) return { email, status: 'skip_existing', registrantId: r.id, existing };
    const notes: string[] = [];
    if (r.unsubscribed === 'Yes') notes.push('unsubscribed');
    if (r.nfc === 'Yes') notes.push('no further contact');
    return { email, status: existing > 0 ? 'replace' : 'create', registrantId: r.id, firstName: r.first_name, notes, existing };
  });
}

/**
 * The sign-in link for a token. The base must be https (http only for localhost) so a
 * link is never generated for an insecure or mistyped host; any path/query on it is dropped.
 */
export function buildInviteLink(baseUrl: string, token: string): string {
  let url: URL;
  try { url = new URL(baseUrl.trim()); } catch { throw new Error(`Not a valid base URL: ${baseUrl}`); }
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) {
    throw new Error('The base URL must start with https:// (http:// only for localhost).');
  }
  return `${url.origin}/member/sign-in?i=${encodeURIComponent(token)}`;
}
