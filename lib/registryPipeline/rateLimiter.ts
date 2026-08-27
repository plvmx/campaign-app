// Rate-limit pacing/backoff for the registry pipeline's ActiveCampaign
// polling. See docs/registry-pipeline/AFJ_PII_Technical_Implementation_Plan.md
// Section 3.2/6.1 — the AC API key is shared, account-wide, and enforces
// 5 requests/second across every integration using it, not just this one.

/** Fixed pacing delay between paginated AC requests during a normal run. */
export const REQUEST_PACING_MS = 250;

/**
 * Computes how long to wait before retrying after an HTTP 429, honoring
 * AC's `Retry-After` header (seconds) when present rather than a fixed
 * delay, with capped exponential backoff as a fallback if the header is
 * missing or unparseable.
 */
export function computeBackoffMs(retryAfterHeader: string | null | undefined, attempt: number): number {
  if (retryAfterHeader) {
    const seconds = Number(retryAfterHeader);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return seconds * 1000;
    }
  }
  const MAX_BACKOFF_MS = 30_000;
  const backoff = REQUEST_PACING_MS * 2 ** Math.max(attempt, 0);
  return Math.min(backoff, MAX_BACKOFF_MS);
}

/** Promise-based sleep — works identically under Node (Vitest) and Deno. */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
