// Phone normalization for the registry pipeline.
// See docs/registry-pipeline/AFJ_PII_Technical_Implementation_Plan.md
// Section 6.2 — confirmed via testing that AC contacts arrive with phone
// numbers in at least 3 different formats ('+61438438438', '0438438438',
// '0438 438 438'). WhatsApp invite-link automation (a later phase) requires
// a single consistent E.164 format, so every phone is normalized here
// before being stored on registry.registrants.phone (the original is kept
// as-is on .phone_raw for audit/debugging).

/**
 * Normalizes an Australian phone number to E.164 ('+61...').
 * Returns null for empty/whitespace-only input rather than guessing.
 *
 * This is a best-effort normalization, not validation — a value that
 * doesn't start with '61' or '0' after stripping non-digits is assumed to
 * already be missing its country code and '+61' is prepended (per the
 * technical plan's documented fallback), which may occasionally be wrong
 * for the odd non-Australian test contact; flagged for manual review is a
 * follow-up, not implemented here.
 */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 0) return null;

  if (digits.startsWith('61')) return `+${digits}`;
  if (digits.startsWith('0')) return `+61${digits.substring(1)}`;
  return `+61${digits}`;
}
