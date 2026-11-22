/**
 * Member portal sign-in — the server side (docs/member-portal/SIGN_IN_DESIGN.md).
 *
 * A registrant proves they own BOTH the email address and the mobile number we
 * hold for them by typing a code sent to each. Everything lives in the
 * registry.member_* tables, reachable only through the service role; members
 * are never Supabase Auth users and never hold a database credential.
 *
 * Injected client (always `supabaseAdmin` in practice) and injected senders,
 * same DI pattern as backupService.ts, so every path is testable without a
 * database, an email provider or an SMS provider.
 *
 * Nothing in here ever logs or returns a code, and codes/tokens/session ids
 * are stored only as hashes (lib/memberCodes.ts).
 */
import { randomUUID } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizePhone } from '@/lib/registryPipeline/phone';
import { isValidEmail } from '@/lib/emailFormat';
import { generateCode, generateToken, hashCode, hashIp, hashToken, verifyCode } from '@/lib/memberCodes';
import { maskEmail, maskMobile } from '@/lib/memberMasking';
import { decideSend, MEMBER_THROTTLE, type ThrottleDecision } from '@/lib/memberThrottle';
import { MEMBER_SESSION_TOUCH_AFTER_MS, MEMBER_SESSION_TTL_MS } from '@/lib/memberSession';
import { buildMemberCodeEmail, buildMemberSmsBody, MEMBER_CODE_EXPIRY_MINUTES } from '@/lib/memberCodeMessages';
import { isVerificationId, type RequestCodesInput, type VerifyInput } from '@/lib/memberSignInInput';
import type { OutgoingEmail } from '@/lib/resendClient';

export const MEMBER_VERIFICATION_TTL_MS = MEMBER_CODE_EXPIRY_MINUTES * 60 * 1000;
export const MEMBER_MAX_VERIFY_ATTEMPTS = 5;
/** Wrong-code answers allowed from one IP per hour before it is refused outright. */
export const MEMBER_VERIFY_FAILS_PER_IP_PER_HOUR = 20;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const REGISTRANT_COLUMNS = 'id, first_name, email, phone';

export interface MemberAuthDeps {
  secret: string;
  sendEmail: (email: OutgoingEmail) => Promise<unknown>;
  sendSms: (toE164: string, body: string) => Promise<unknown>;
  /** Overridable clock, for tests. */
  now?: () => Date;
  /** Global text-messages-per-day ceiling (app_settings `member_sms_daily_ceiling`); default in memberThrottle.ts. */
  smsCeiling?: number;
}

interface RegistrantRow { id: string; first_name: string | null; email: string | null; phone: string | null }

type MemberEvent =
  | 'codes_sent' | 'email_failed' | 'sms_failed' | 'ineligible' | 'throttled'
  | 'verify_ok' | 'verify_bad' | 'verify_locked' | 'session_revoked';

const registry = (client: SupabaseClient) => client.schema('registry');
const clockOf = (deps: { now?: () => Date }) => (deps.now ? deps.now() : new Date());
const iso = (d: Date) => d.toISOString();

/** Placeholder addresses the registry holds for people who gave none (e.g. noemail@noemail.com). */
export function isPlaceholderEmail(email: string): boolean {
  const lower = email.trim().toLowerCase();
  return lower.startsWith('noemail@') || lower.endsWith('@noemail.com') || lower.endsWith('@example.com');
}

/** Can this registrant sign in by themselves? Needs a usable email AND a mobile on file. */
export function isEligibleForSignIn(r: Pick<RegistrantRow, 'email' | 'phone'>): boolean {
  return !!r.email && isValidEmail(r.email) && !isPlaceholderEmail(r.email) && !!r.phone && r.phone.replace(/\D/g, '').length >= 9;
}

async function logEvent(
  client: SupabaseClient,
  event: MemberEvent,
  fields: { registrantId?: string | null; ipHash?: string | null; detail?: string | null },
): Promise<void> {
  // The audit trail must never break a sign-in or hide the real outcome.
  try {
    const { error } = await registry(client).from('member_auth_events').insert({
      event,
      registrant_id: fields.registrantId ?? null,
      ip_hash: fields.ipHash ?? null,
      detail: fields.detail ?? null,
    });
    if (error) console.error('member_auth_events insert failed:', error.message);
  } catch (err) {
    console.error('member_auth_events insert threw:', err);
  }
}

async function countEvents(
  client: SupabaseClient,
  q: { events: MemberEvent[]; since: Date; registrantId?: string; ipHash?: string },
): Promise<number> {
  let query = registry(client)
    .from('member_auth_events')
    .select('id', { count: 'exact', head: true })
    .in('event', q.events)
    .gte('created_at', iso(q.since));
  if (q.registrantId) query = query.eq('registrant_id', q.registrantId);
  if (q.ipHash) query = query.eq('ip_hash', q.ipHash);
  const { count, error } = await query;
  if (error) throw new Error(`Counting member sign-in events failed: ${error.message}`);
  return count ?? 0;
}

async function getRegistrantById(client: SupabaseClient, id: string): Promise<RegistrantRow | null> {
  const { data, error } = await registry(client).from('registrants').select(REGISTRANT_COLUMNS).eq('id', id).maybeSingle();
  if (error) throw new Error(`Registrant lookup failed: ${error.message}`);
  return (data as RegistrantRow | null) ?? null;
}

/** Typed path: both the email and the mobile must belong to the SAME registrant. */
async function findRegistrantByContact(client: SupabaseClient, email: string, mobile: string): Promise<RegistrantRow | null> {
  const phone = normalizePhone(mobile);
  if (!phone) return null;
  const { data, error } = await registry(client)
    .from('registrants')
    .select(REGISTRANT_COLUMNS)
    .eq('email', email.trim().toLowerCase())
    .limit(1);
  if (error) throw new Error(`Registrant lookup by email failed: ${error.message}`);
  const row = ((data as RegistrantRow[] | null) ?? [])[0];
  return row && row.phone === phone ? row : null;
}

// ---------------------------------------------------------------------------
// Invites

/** Creates the opaque sign-in link token for a registrant. Returns the raw token — shown/sent once, stored only hashed. */
export async function createMemberInvite(
  client: SupabaseClient,
  deps: Pick<MemberAuthDeps, 'now'>,
  registrantId: string,
  ttlDays = 90,
): Promise<string> {
  const token = generateToken();
  const { error } = await registry(client).from('member_invites').insert({
    registrant_id: registrantId,
    token_hash: hashToken(token),
    expires_at: iso(new Date(clockOf(deps).getTime() + ttlDays * DAY_MS)),
  });
  if (error) throw new Error(`Creating a member invite failed: ${error.message}`);
  return token;
}

export interface InviteView {
  inviteId: number;
  registrantId: string;
  maskedEmail: string | null;
  maskedMobile: string | null;
  /** False when the registrant can't self-serve (no mobile / placeholder email) — the page shows the help path. */
  eligible: boolean;
}

/** Looks up an invite link. Returns null for an unknown, revoked or expired token (one indistinguishable answer). */
export async function lookupInvite(
  client: SupabaseClient,
  deps: Pick<MemberAuthDeps, 'now'>,
  token: string,
): Promise<InviteView | null> {
  const now = clockOf(deps);
  const { data, error } = await registry(client)
    .from('member_invites')
    .select('id, registrant_id, expires_at, revoked_at')
    .eq('token_hash', hashToken(token))
    .maybeSingle();
  if (error) throw new Error(`Invite lookup failed: ${error.message}`);
  const invite = data as { id: number; registrant_id: string; expires_at: string; revoked_at: string | null } | null;
  if (!invite || invite.revoked_at || new Date(invite.expires_at) <= now) return null;

  const registrant = await getRegistrantById(client, invite.registrant_id);
  if (!registrant) return null;

  const { error: touchError } = await registry(client).from('member_invites').update({ last_opened_at: iso(now) }).eq('id', invite.id);
  if (touchError) console.error('member_invites touch failed:', touchError.message);

  return {
    inviteId: invite.id,
    registrantId: registrant.id,
    maskedEmail: registrant.email && !isPlaceholderEmail(registrant.email) ? maskEmail(registrant.email) : null,
    maskedMobile: registrant.phone ? maskMobile(registrant.phone) : null,
    eligible: isEligibleForSignIn(registrant),
  };
}

// ---------------------------------------------------------------------------
// Sending codes

export type RequestCodesResult =
  | { status: 'sent'; verificationId: string; maskedEmail: string; maskedMobile: string }
  /** Nobody matched, or the match can't self-serve. Callers must answer exactly as for 'sent' (enumeration resistance). */
  | { status: 'no_match' }
  | { status: 'throttled'; reason: Exclude<ThrottleDecision, { allowed: true }>['reason'] }
  | { status: 'send_failed' };

export async function requestCodes(
  client: SupabaseClient,
  deps: MemberAuthDeps,
  input: RequestCodesInput,
  ip: string,
): Promise<RequestCodesResult> {
  const now = clockOf(deps);
  const ipHash = hashIp(ip, deps.secret);

  // Per-IP limit first: it covers guesses at contact details as well as real sends.
  const ipWindow = await countEvents(client, {
    events: ['codes_sent', 'ineligible'],
    since: new Date(now.getTime() - MEMBER_THROTTLE.perIpWindowMs),
    ipHash,
  });
  if (ipWindow >= MEMBER_THROTTLE.perIpWindowMax) {
    await logEvent(client, 'throttled', { ipHash, detail: 'ip' });
    return { status: 'throttled', reason: 'ip' };
  }

  let registrant: RegistrantRow | null = null;
  let inviteId: number | null = null;
  if (input.via === 'invite') {
    const invite = await lookupInvite(client, deps, input.inviteToken);
    if (invite) {
      inviteId = invite.inviteId;
      registrant = await getRegistrantById(client, invite.registrantId);
    }
  } else {
    registrant = await findRegistrantByContact(client, input.email, input.mobile);
  }

  if (!registrant || !isEligibleForSignIn(registrant)) {
    await logEvent(client, 'ineligible', { registrantId: registrant?.id ?? null, ipHash, detail: registrant ? 'not_eligible' : 'no_match' });
    return { status: 'no_match' };
  }

  const dayAgo = new Date(now.getTime() - DAY_MS);
  const [recentCooldown, personWindow, personDay, smsToday] = await Promise.all([
    countEvents(client, { events: ['codes_sent'], since: new Date(now.getTime() - MEMBER_THROTTLE.resendCooldownMs), registrantId: registrant.id }),
    countEvents(client, { events: ['codes_sent'], since: new Date(now.getTime() - MEMBER_THROTTLE.perPersonWindowMs), registrantId: registrant.id }),
    countEvents(client, { events: ['codes_sent'], since: dayAgo, registrantId: registrant.id }),
    countEvents(client, { events: ['codes_sent'], since: dayAgo }),
  ]);
  const decision = decideSend({ recentCooldown, personWindow, personDay, ipWindow, smsToday }, deps.smsCeiling);
  if (!decision.allowed) {
    await logEvent(client, 'throttled', { registrantId: registrant.id, ipHash, detail: decision.reason });
    return { status: 'throttled', reason: decision.reason };
  }

  const verificationId = randomUUID();
  const emailCode = generateCode();
  const smsCode = generateCode();
  const { error: insertError } = await registry(client).from('member_verifications').insert({
    id: verificationId,
    registrant_id: registrant.id,
    invite_id: inviteId,
    email_code_hash: hashCode(emailCode, verificationId, 'email', deps.secret),
    sms_code_hash: hashCode(smsCode, verificationId, 'sms', deps.secret),
    expires_at: iso(new Date(now.getTime() + MEMBER_VERIFICATION_TTL_MS)),
  });
  if (insertError) throw new Error(`Creating a verification failed: ${insertError.message}`);

  // Only ever to the details ON FILE — never to anything the visitor typed.
  const [emailResult, smsResult] = await Promise.allSettled([
    deps.sendEmail(buildMemberCodeEmail(registrant.email as string, registrant.first_name, emailCode)),
    deps.sendSms(registrant.phone as string, buildMemberSmsBody(smsCode)),
  ]);
  if (emailResult.status === 'rejected' || smsResult.status === 'rejected') {
    if (emailResult.status === 'rejected') {
      await logEvent(client, 'email_failed', { registrantId: registrant.id, ipHash, detail: errorText(emailResult.reason) });
    }
    if (smsResult.status === 'rejected') {
      await logEvent(client, 'sms_failed', { registrantId: registrant.id, ipHash, detail: errorText(smsResult.reason) });
    }
    // Half-delivered codes are useless (both are needed) — retire them.
    const { error: retireError } = await registry(client)
      .from('member_verifications')
      .update({ consumed_at: iso(now) })
      .eq('id', verificationId);
    if (retireError) console.error('retiring an undeliverable verification failed:', retireError.message);
    return { status: 'send_failed' };
  }

  await logEvent(client, 'codes_sent', { registrantId: registrant.id, ipHash });
  return {
    status: 'sent',
    verificationId,
    maskedEmail: maskEmail(registrant.email as string),
    maskedMobile: maskMobile(registrant.phone as string),
  };
}

function errorText(reason: unknown): string {
  return (reason instanceof Error ? reason.message : String(reason)).slice(0, 300);
}

// ---------------------------------------------------------------------------
// Checking codes

export type VerifyResult =
  | { ok: true; sessionId: string; registrantId: string }
  | { ok: false; reason: 'invalid' | 'expired' | 'locked' | 'too_many' };

export async function verifyCodes(
  client: SupabaseClient,
  deps: MemberAuthDeps,
  input: VerifyInput,
  ctx: { ip: string; userAgent: string | null },
): Promise<VerifyResult> {
  const now = clockOf(deps);
  const ipHash = hashIp(ctx.ip, deps.secret);

  const recentFails = await countEvents(client, {
    events: ['verify_bad'],
    since: new Date(now.getTime() - HOUR_MS),
    ipHash,
  });
  if (recentFails >= MEMBER_VERIFY_FAILS_PER_IP_PER_HOUR) return { ok: false, reason: 'too_many' };

  if (!isVerificationId(input.verificationId)) return { ok: false, reason: 'invalid' };

  const { data, error } = await registry(client)
    .from('member_verifications')
    .select('id, registrant_id, email_code_hash, sms_code_hash, expires_at, attempts, consumed_at')
    .eq('id', input.verificationId)
    .maybeSingle();
  if (error) throw new Error(`Verification lookup failed: ${error.message}`);
  const v = data as {
    id: string; registrant_id: string; email_code_hash: string; sms_code_hash: string;
    expires_at: string; attempts: number; consumed_at: string | null;
  } | null;

  // An unknown id looks exactly like a wrong code (also covers the decoy id handed out for non-matches).
  if (!v || v.consumed_at) {
    await logEvent(client, 'verify_bad', { ipHash, detail: v ? 'consumed' : 'unknown' });
    return { ok: false, reason: 'invalid' };
  }
  if (new Date(v.expires_at) <= now) return { ok: false, reason: 'expired' };
  if (v.attempts >= MEMBER_MAX_VERIFY_ATTEMPTS) return { ok: false, reason: 'locked' };

  // Count the attempt BEFORE checking, and only if nobody else changed the count meanwhile
  // (parallel guesses can't each get a "free" try).
  const { data: bumped, error: bumpError } = await registry(client)
    .from('member_verifications')
    .update({ attempts: v.attempts + 1 })
    .eq('id', v.id)
    .eq('attempts', v.attempts)
    .select('id');
  if (bumpError) throw new Error(`Recording a verification attempt failed: ${bumpError.message}`);
  if (!bumped || (bumped as unknown[]).length === 0) return { ok: false, reason: 'invalid' };

  // Both checks always run, so timing doesn't reveal which code was right.
  const emailOk = verifyCode(input.emailCode, v.email_code_hash, v.id, 'email', deps.secret);
  const smsOk = verifyCode(input.smsCode, v.sms_code_hash, v.id, 'sms', deps.secret);
  if (!(emailOk && smsOk)) {
    await logEvent(client, 'verify_bad', { registrantId: v.registrant_id, ipHash });
    if (v.attempts + 1 >= MEMBER_MAX_VERIFY_ATTEMPTS) {
      await logEvent(client, 'verify_locked', { registrantId: v.registrant_id, ipHash });
      return { ok: false, reason: 'locked' };
    }
    return { ok: false, reason: 'invalid' };
  }

  // Single use: only the caller that flips consumed_at from null gets the session.
  const { data: consumed, error: consumeError } = await registry(client)
    .from('member_verifications')
    .update({ consumed_at: iso(now) })
    .eq('id', v.id)
    .is('consumed_at', null)
    .select('id');
  if (consumeError) throw new Error(`Consuming a verification failed: ${consumeError.message}`);
  if (!consumed || (consumed as unknown[]).length === 0) return { ok: false, reason: 'invalid' };

  const sessionId = generateToken();
  const { error: sessionError } = await registry(client).from('member_sessions').insert({
    registrant_id: v.registrant_id,
    session_hash: hashToken(sessionId),
    expires_at: iso(new Date(now.getTime() + MEMBER_SESSION_TTL_MS)),
    device_label: ctx.userAgent ? ctx.userAgent.slice(0, 120) : null,
  });
  if (sessionError) throw new Error(`Creating a member session failed: ${sessionError.message}`);

  await logEvent(client, 'verify_ok', { registrantId: v.registrant_id, ipHash });
  return { ok: true, sessionId, registrantId: v.registrant_id };
}

// ---------------------------------------------------------------------------
// Sessions

export interface MemberSession { registrantId: string; firstName: string | null }

/** The signed-in member for a (signature-checked) session id, or null if unknown/revoked/expired. */
export async function getMemberSession(
  client: SupabaseClient,
  deps: Pick<MemberAuthDeps, 'now'>,
  sessionId: string,
): Promise<MemberSession | null> {
  const now = clockOf(deps);
  const { data, error } = await registry(client)
    .from('member_sessions')
    .select('id, registrant_id, last_seen_at, expires_at, revoked_at')
    .eq('session_hash', hashToken(sessionId))
    .maybeSingle();
  if (error) throw new Error(`Session lookup failed: ${error.message}`);
  const session = data as { id: number; registrant_id: string; last_seen_at: string; expires_at: string; revoked_at: string | null } | null;
  if (!session || session.revoked_at || new Date(session.expires_at) <= now) return null;

  const registrant = await getRegistrantById(client, session.registrant_id);
  if (!registrant) return null;

  // Sliding expiry, but not a write on every request.
  if (now.getTime() - new Date(session.last_seen_at).getTime() >= MEMBER_SESSION_TOUCH_AFTER_MS) {
    const { error: touchError } = await registry(client)
      .from('member_sessions')
      .update({ last_seen_at: iso(now), expires_at: iso(new Date(now.getTime() + MEMBER_SESSION_TTL_MS)) })
      .eq('id', session.id);
    if (touchError) console.error('member_sessions touch failed:', touchError.message);
  }
  return { registrantId: registrant.id, firstName: registrant.first_name };
}

/** Signs out one device. */
export async function revokeMemberSession(client: SupabaseClient, deps: Pick<MemberAuthDeps, 'now'>, sessionId: string): Promise<void> {
  const { error } = await registry(client)
    .from('member_sessions')
    .update({ revoked_at: iso(clockOf(deps)) })
    .eq('session_hash', hashToken(sessionId))
    .is('revoked_at', null);
  if (error) throw new Error(`Signing out failed: ${error.message}`);
}

/** Signs out every device this registrant is signed in on. */
export async function revokeAllMemberSessions(client: SupabaseClient, deps: Pick<MemberAuthDeps, 'now'>, registrantId: string): Promise<void> {
  const { error } = await registry(client)
    .from('member_sessions')
    .update({ revoked_at: iso(clockOf(deps)) })
    .eq('registrant_id', registrantId)
    .is('revoked_at', null);
  if (error) throw new Error(`Signing out of all devices failed: ${error.message}`);
  await logEvent(client, 'session_revoked', { registrantId, detail: 'all_devices' });
}
