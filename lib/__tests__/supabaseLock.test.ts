/**
 * A tab frozen by the phone while holding the shared auth lock used to leave
 * every other tab waiting for it forever — the app sat on "Loading…"
 * (Peter_AD, 2026-10-14). These run supabase-js's real navigatorLock against
 * a minimal in-memory LockManager.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { navigatorLock } from '@supabase/supabase-js';
import { createNonBlockingAuthLock, AUTH_LOCK_WAIT_MS } from '../supabaseLock';

/** Exclusive locks with abort-signal, ifAvailable and steal support — enough of LockManager for these tests. */
function fakeLockManager() {
  const held = new Set<string>();
  const waiters = new Map<string, Array<() => void>>();
  async function request(name: string, opts: LockOptions, cb: (lock: { name: string } | null) => Promise<unknown>) {
    if (held.has(name) && !opts.steal) {
      if (opts.ifAvailable) return cb(null);
      await new Promise<void>((resolve, reject) => {
        const list = waiters.get(name) ?? [];
        list.push(resolve);
        waiters.set(name, list);
        opts.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      });
    }
    held.add(name);
    try {
      return await cb({ name });
    } finally {
      held.delete(name);
      waiters.get(name)?.shift()?.();
    }
  }
  /** Simulates a frozen tab: takes the lock and never lets go. */
  function holdForever(name: string) {
    void request(name, { mode: 'exclusive' }, () => new Promise(() => {}));
  }
  return { request: request as unknown as LockManager['request'], holdForever };
}

let locks: ReturnType<typeof fakeLockManager>;
beforeEach(() => {
  vi.useFakeTimers();
  locks = fakeLockManager();
  vi.stubGlobal('navigator', { locks });
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('createNonBlockingAuthLock', () => {
  it('runs straight through when the lock is free', async () => {
    const lock = createNonBlockingAuthLock(locks);
    await expect(lock('auth', -1, async () => 'ok')).resolves.toBe('ok');
  });

  it('takes the lock over from a stuck tab instead of waiting forever', async () => {
    locks.holdForever('auth');
    const lock = createNonBlockingAuthLock(locks);
    const result = lock('auth', -1, async () => 'ok');

    await vi.advanceTimersByTimeAsync(AUTH_LOCK_WAIT_MS);
    await expect(result).resolves.toBe('ok');
  });

  it('(supabase-js\'s default lock does wait forever — the bug this replaces)', async () => {
    locks.holdForever('auth');
    let settled = false;
    void navigatorLock('auth', -1, async () => 'ok').finally(() => { settled = true; });

    await vi.advanceTimersByTimeAsync(60_000);
    expect(settled).toBe(false);
  });

  it('never re-runs the work when the work itself fails', async () => {
    const lock = createNonBlockingAuthLock(locks);
    const fn = vi.fn().mockRejectedValue(new DOMException('fetch aborted', 'AbortError'));
    await expect(lock('auth', -1, fn)).rejects.toThrow('fetch aborted');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('leaves "only if free" calls (timeout 0) as they were', async () => {
    locks.holdForever('auth');
    const lock = createNonBlockingAuthLock(locks);
    await expect(lock('auth', 0, async () => 'ok')).rejects.toThrow(/immediately failed/);
  });

  it('just runs the work where the browser has no LockManager (e.g. during server rendering)', async () => {
    const lock = createNonBlockingAuthLock(undefined);
    await expect(lock('auth', -1, async () => 'ok')).resolves.toBe('ok');
  });
});
