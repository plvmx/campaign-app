/**
 * Format validators for public-facing contact-detail forms (currently just
 * /public/register-interest, which requires a *valid* mobile number or
 * email rather than merely a non-empty one — see the PR that added this
 * file). Deliberately loose, not exhaustive RFC validators: just enough to
 * catch obviously-wrong input, since real deliverability is confirmed by
 * the leader following up, not by this check.
 */
import { normalizeMobile } from './auth';

/** True if the value, once normalized, is a plausible Australian mobile number (04XX XXX XXX). */
export function isValidMobile(value: string): boolean {
  return /^04\d{8}$/.test(normalizeMobile(value));
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** True if the value is a plausible email address (basic shape check). */
export function isValidEmail(value: string): boolean {
  return EMAIL_PATTERN.test(value.trim());
}
