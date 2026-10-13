import type { SupabaseClient } from '@supabase/supabase-js';
import { isRecognizedAdminStatus } from '@/lib/campaignFilter';

/**
 * "Who is stuck setting up email sign-in / 2FA, and where?" — for the admin
 * who has to phone them. Works purely from data we already hold: each
 * leader's rows in state_leaders plus the email-sign-in account Supabase made
 * for their address (when an email was last sent, and when a link was last
 * used). Per PERSON, not per row (one real person can have nine rows).
 *
 * Admins (AD/SR) are listed at every stage until they've enrolled, because
 * they cannot sign in as an admin without 2FA. Plain leaders are only listed
 * if they actually started and didn't finish — never for not having started,
 * since 2FA is optional for them.
 */

export interface LeaderRow {
  id: string;
  leader: string;
  state: string;
  admin: string | null;
  mobile: string | null;
  email: string | null;
  pending_email: string | null;
  email_confirmed_at: string | null;
  mfa_enrolled_at: string | null;
  user_id: string | null;
  last_sign_in_at: string | null;
}

export interface AuthEmailInfo {
  /** Latest time Supabase sent this address a sign-in/confirmation email. */
  emailSentAt: string | null;
  /** Latest time a link/code for this address was used. */
  lastUsedAt: string | null;
}

export type StuckStage =
  | 'not-started'
  | 'email-not-sent'
  | 'email-link-unused'
  | 'email-link-used'
  | '2fa-not-started'
  | '2fa-link-unused'
  | '2fa-started';

export interface StuckLeader {
  key: string;
  name: string;
  role: 'Admin' | 'State Reporter' | 'Leader';
  isAdmin: boolean;
  states: string[];
  mobile: string | null;
  email: string | null;
  stage: StuckStage;
  label: string;
  action: string;
  lastActivityAt: string | null;
}

const STAGES: Record<StuckStage, { label: string; action: string; adminOnly?: boolean }> = {
  'not-started': {
    label: 'Has not started — no email on file',
    action: 'Ask them to sign in. They will be guided through confirming an email address.',
    adminOnly: true,
  },
  'email-not-sent': {
    label: 'Entered an email but no message was sent',
    action: 'Ask them to try again from the sign-in page.',
  },
  'email-link-unused': {
    label: 'Confirmation email sent — link not used',
    action: 'Ask them to check their Junk/Spam folder, then tap CONFIRM NOW (or type the code from the email).',
  },
  'email-link-used': {
    label: 'Opened the confirmation link but did not finish',
    action: 'Ask them to try again and tap the blue button on the page that opens.',
  },
  '2fa-not-started': {
    label: 'Email confirmed — 2FA not started',
    action: 'Ask them to sign in and choose "Set up now". The guide is at /help/2fa.',
    adminOnly: true,
  },
  '2fa-link-unused': {
    label: '2FA setup email sent — link not used',
    action: 'Ask them to check Junk/Spam, then tap CONFIRM NOW in that email.',
  },
  '2fa-started': {
    label: 'Opened 2FA setup but did not finish',
    action: 'Usually the 6-digit code. Check: newest AFJ entry in their app, phone clock on automatic, old AFJ entries deleted.',
  },
};

const digits = (mobile: string | null) => (mobile ?? '').replace(/\D/g, '').replace(/^61/, '0');
const ms = (iso: string | null | undefined) => (iso ? new Date(iso).getTime() : null);
const latest = (...values: (string | null | undefined)[]): string | null => {
  const withValue = values.filter((v): v is string => !!v);
  if (withValue.length === 0) return null;
  return withValue.reduce((a, b) => (new Date(a) >= new Date(b) ? a : b));
};

/** Pure: which people are stuck, and at what stage. */
export function classifyStuckLeaders(
  rows: LeaderRow[],
  authByEmail: Map<string, AuthEmailInfo>,
): StuckLeader[] {
  const people = new Map<string, LeaderRow[]>();
  for (const row of rows) {
    const key = digits(row.mobile) || row.id;
    people.set(key, [...(people.get(key) ?? []), row]);
  }

  const out: StuckLeader[] = [];
  for (const [key, personRows] of people) {
    if (personRows.some((r) => r.mfa_enrolled_at)) continue; // done

    const adminRow = personRows.find((r) => r.admin === 'AD') ?? personRows.find((r) => r.admin === 'SR');
    const isAdmin = personRows.some((r) => isRecognizedAdminStatus(r.admin));
    const display = adminRow ?? [...personRows].sort((a, b) => (b.last_sign_in_at ?? '').localeCompare(a.last_sign_in_at ?? ''))[0];

    const confirmedAt = latest(...personRows.map((r) => r.email_confirmed_at));
    const email = personRows.find((r) => r.email)?.email ?? null;
    const pending = personRows.find((r) => r.pending_email)?.pending_email ?? null;
    const hasEmailOnFile = !!email; // confirmed by them, or entered by an admin (which counts as confirmed)
    // The address a still-unfinished email is going to / came from.
    const relevantAddress = (hasEmailOnFile ? email : pending)?.trim().toLowerCase() ?? null;
    const auth = relevantAddress ? authByEmail.get(relevantAddress) : undefined;
    const sentAt = auth?.emailSentAt ?? null;
    const usedAt = auth?.lastUsedAt ?? null;
    const used = !!sentAt && !!usedAt && (ms(usedAt) as number) >= (ms(sentAt) as number);

    let stage: StuckStage;
    if (!hasEmailOnFile && !pending) {
      stage = 'not-started';
    } else if (!hasEmailOnFile) {
      // proposed an address, never confirmed
      stage = !sentAt ? 'email-not-sent' : used ? 'email-link-used' : 'email-link-unused';
    } else {
      // email is in place; anything sent since confirmation is the 2FA setup email
      const setupEmailSent = !!sentAt && (!confirmedAt || (ms(sentAt) as number) > (ms(confirmedAt) as number));
      stage = !setupEmailSent ? '2fa-not-started' : used ? '2fa-started' : '2fa-link-unused';
    }

    if (STAGES[stage].adminOnly && !isAdmin) continue; // plain leaders: only if they actually tried

    out.push({
      key,
      name: display.leader.trim(),
      role: adminRow?.admin === 'AD' ? 'Admin' : adminRow?.admin === 'SR' ? 'State Reporter' : 'Leader',
      isAdmin,
      states: [...new Set(personRows.map((r) => r.state))].sort(),
      mobile: personRows.find((r) => r.mobile)?.mobile ?? null,
      email: email ?? pending,
      stage,
      label: STAGES[stage].label,
      action: STAGES[stage].action,
      lastActivityAt: latest(sentAt, usedAt, ...personRows.map((r) => r.last_sign_in_at)),
    });
  }

  // Admins first (they cannot sign in as admin until done), then the most recently active (warmest) first.
  return out.sort((a, b) => {
    if (a.isAdmin !== b.isAdmin) return a.isAdmin ? -1 : 1;
    return (b.lastActivityAt ?? '').localeCompare(a.lastActivityAt ?? '');
  });
}

/** Loads state_leaders and the email accounts, then classifies. Injected client (always supabaseAdmin). */
export async function getStuckLeaders(client: SupabaseClient): Promise<StuckLeader[]> {
  const { data: rows, error } = await client
    .from('state_leaders')
    .select('id, leader, state, admin, mobile, email, pending_email, email_confirmed_at, mfa_enrolled_at, user_id, last_sign_in_at');
  if (error) throw error;

  const authByEmail = new Map<string, AuthEmailInfo>();
  for (let page = 1; ; page++) {
    const { data, error: listError } = await client.auth.admin.listUsers({ page, perPage: 1000 });
    if (listError) throw listError;
    for (const user of data.users) {
      if (user.is_anonymous || !user.email) continue;
      authByEmail.set(user.email.toLowerCase(), {
        emailSentAt: latest(user.recovery_sent_at, user.confirmation_sent_at),
        lastUsedAt: user.last_sign_in_at ?? null,
      });
    }
    if (data.users.length < 1000) break;
  }

  return classifyStuckLeaders((rows ?? []) as LeaderRow[], authByEmail);
}
