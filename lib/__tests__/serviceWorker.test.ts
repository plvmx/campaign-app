/**
 * public/sw.js must only intercept same-origin pages and static assets.
 * Intercepting Supabase (cross-origin) and /api/ calls cloned every live
 * response into Cache Storage, slowing every request on mobile.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function loadFetchHandler() {
  const handlers: Record<string, (e: unknown) => void> = {};
  const fakeSelf = {
    location: { origin: 'https://app.example.com' },
    addEventListener: (type: string, fn: (e: unknown) => void) => { handlers[type] = fn; },
    skipWaiting: vi.fn(),
    clients: { claim: vi.fn() },
  };
  const src = readFileSync(join(process.cwd(), 'public/sw.js'), 'utf8');
  new Function('self', 'caches', 'fetch', src)(fakeSelf, { open: vi.fn(), match: vi.fn() }, vi.fn().mockRejectedValue(new Error('offline')));
  return handlers.fetch;
}

function run(url: string, method = 'GET') {
  const respondWith = vi.fn();
  loadFetchHandler()({ request: { url, method }, respondWith });
  return respondWith;
}

describe('service worker fetch handler', () => {
  it('handles same-origin page and asset requests', () => {
    expect(run('https://app.example.com/app')).toHaveBeenCalled();
    expect(run('https://app.example.com/_next/static/x.js')).toHaveBeenCalled();
  });

  it('leaves cross-origin (Supabase) requests alone', () => {
    expect(run('https://abc.supabase.co/rest/v1/campaigns')).not.toHaveBeenCalled();
  });

  it('leaves same-origin /api/ requests alone', () => {
    expect(run('https://app.example.com/api/auth/validate-leader')).not.toHaveBeenCalled();
  });

  it('leaves non-GET requests alone', () => {
    expect(run('https://app.example.com/app', 'POST')).not.toHaveBeenCalled();
  });
});
