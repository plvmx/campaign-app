/**
 * Secrets for the member portal sign-in (docs/member-portal/SIGN_IN_DESIGN.md):
 * one-time codes, invite tokens and session ids. Pure, server-only (Node
 * crypto). Nothing here touches the database.
 *
 * Codes are 6 digits, stored only as a keyed hash (HMAC-SHA-256) bound to the
 * verification they belong to and to which channel they were sent on, so a
 * code can't be replayed against another verification or across channels.
 * Tokens and session ids are 32 random bytes, stored as plain SHA-256 (they
 * are high-entropy, so no key is needed to resist guessing).
 */
import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'crypto';

import { MEMBER_CODE_LENGTH } from './memberFormat';

export { MEMBER_CODE_LENGTH };

export type CodeChannel = 'email' | 'sms';

/** The server secret. Throws rather than falling back, so a missing secret can never silently weaken sign-in. */
export function getMemberAuthSecret(env: NodeJS.ProcessEnv = process.env): string {
  const secret = env.MEMBER_AUTH_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('MEMBER_AUTH_SECRET is not set (or shorter than 32 characters)');
  }
  return secret;
}

/** A uniformly random 6-digit code, leading zeros kept ("004821"). */
export function generateCode(): string {
  return randomInt(0, 10 ** MEMBER_CODE_LENGTH).toString().padStart(MEMBER_CODE_LENGTH, '0');
}

export function hashCode(code: string, verificationId: string, channel: CodeChannel, secret: string): string {
  return createHmac('sha256', secret).update(`${channel}:${verificationId}:${code}`).digest('hex');
}

/** Constant-time check of a typed code against its stored hash. Wrong-shaped input is simply false. */
export function verifyCode(
  typed: string,
  storedHash: string,
  verificationId: string,
  channel: CodeChannel,
  secret: string,
): boolean {
  if (!new RegExp(`^\\d{${MEMBER_CODE_LENGTH}}$`).test(typed)) return false;
  const expected = Buffer.from(hashCode(typed, verificationId, channel, secret), 'hex');
  const actual = Buffer.from(storedHash, 'hex');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/** 32 random bytes as base64url — used for invite tokens and session ids. */
export function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Keyed, truncated hash of an IP address — enough to throttle by, useless as a location record. */
export function hashIp(ip: string, secret: string): string {
  return createHmac('sha256', secret).update(`ip:${ip}`).digest('hex').slice(0, 32);
}
