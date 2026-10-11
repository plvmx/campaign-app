import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';

vi.mock('@/lib/supabaseClient', () => ({
  supabase: { auth: { getSession: vi.fn() } },
}));

import { supabase } from '@/lib/supabaseClient';
import { requestRegistrationCheck } from '../registrationCheckClient';

const mockGetSession = vi.mocked(supabase.auth.getSession);
const originalFetch = global.fetch;

const INPUT = { firstName: 'Alice', lastName: 'Nguyen', email: 'alice@example.com', mobile: null };

function mockSession(session: { access_token: string } | null) {
  mockGetSession.mockResolvedValue({ data: { session }, error: null } as Awaited<ReturnType<typeof supabase.auth.getSession>>);
}

beforeEach(() => {
  vi.clearAllMocks();
  global.fetch = vi.fn();
});

afterAll(() => {
  global.fetch = originalFetch;
});

describe('requestRegistrationCheck', () => {
  it('throws without calling the API when there is no session', async () => {
    mockSession(null);
    await expect(requestRegistrationCheck(INPUT)).rejects.toThrow(/not signed in/);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('posts the details with a bearer token and returns the result', async () => {
    mockSession({ access_token: 'tok-123' });
    const result = { status: 'registered', matchedOn: ['email'] };
    vi.mocked(global.fetch).mockResolvedValue({ ok: true, json: async () => result } as Response);

    expect(await requestRegistrationCheck(INPUT)).toEqual(result);
    expect(global.fetch).toHaveBeenCalledWith('/api/leader/check-registration', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok-123' },
      body: JSON.stringify(INPUT),
    });
  });

  it("throws the API's own error message on a failed response", async () => {
    mockSession({ access_token: 'tok-123' });
    vi.mocked(global.fetch).mockResolvedValue({
      ok: false, status: 429, json: async () => ({ error: 'Too many checks.' }),
    } as Response);
    await expect(requestRegistrationCheck(INPUT)).rejects.toThrow('Too many checks.');
  });

  it('falls back to a status-code message when the error body is not JSON', async () => {
    mockSession({ access_token: 'tok-123' });
    vi.mocked(global.fetch).mockResolvedValue({
      ok: false, status: 500, json: async () => { throw new Error('not json'); },
    } as unknown as Response);
    await expect(requestRegistrationCheck(INPUT)).rejects.toThrow(/\(500\)/);
  });
});
