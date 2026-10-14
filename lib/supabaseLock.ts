import { navigatorLock } from '@supabase/supabase-js';

/** How long a browser Supabase client waits for its auth lock before taking it over. */
export const AUTH_LOCK_WAIT_MS = 5000;

type LockFn = <R>(name: string, acquireTimeout: number, fn: () => Promise<R>) => Promise<R>;

/**
 * The auth lock every browser Supabase client (lib/supabaseClient.ts,
 * lib/emailConfirmSupabaseClient.ts, lib/registrySupabaseClient.ts) uses.
 *
 * supabase-js's default is a Navigator lock shared by every tab of the app on
 * the device, requested with no time limit (acquireTimeout -1). If one tab
 * holds it and the phone then freezes that tab in the background, every other
 * tab's getSession()/getUser()/queries wait for it forever — the app just sits
 * on "Loading…" (Peter_AD on his phone, 2026-10-14, after several email links
 * had each opened a new tab).
 *
 * This keeps the same cross-tab lock, but an unlimited wait becomes
 * AUTH_LOCK_WAIT_MS, after which the lock is taken over (`steal`) rather than
 * the caller hanging. The lock only stops two tabs refreshing the session at
 * the same moment, and Supabase tolerates a refresh token reused within a few
 * seconds, so taking it over from a stuck tab is safe. Calls with their own
 * timeout (0 = "only if free", used by the background refresh ticker) are
 * unchanged.
 */
export function createNonBlockingAuthLock(
  locks: Pick<LockManager, 'request'> | undefined = globalThis.navigator?.locks,
  baseLock: LockFn = navigatorLock,
): LockFn {
  return async function nonBlockingAuthLock<R>(name: string, acquireTimeout: number, fn: () => Promise<R>): Promise<R> {
    if (!locks) return fn();
    if (acquireTimeout >= 0) return baseLock(name, acquireTimeout, fn);
    // A wait that times out rejects (with an AbortError) before fn ever runs;
    // an error from fn itself must never re-run it.
    let started = false;
    try {
      return await baseLock(name, AUTH_LOCK_WAIT_MS, () => {
        started = true;
        return fn();
      });
    } catch (err) {
      if (started) throw err;
      console.warn(`Auth lock "${name}" was held for over ${AUTH_LOCK_WAIT_MS} ms (another tab stuck?) — taking it over.`);
      return locks.request(name, { steal: true }, () => fn());
    }
  };
}
