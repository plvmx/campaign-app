import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/supabaseAdmin', () => ({
  supabaseAdmin: { schema: vi.fn() },
}));

import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { makeQueryBuilder } from './supabaseMock';
import { getSuggestedEmailByMobile } from '../registrantEmailSuggestionService';

const mockSchema = vi.mocked(supabaseAdmin.schema) as unknown as ReturnType<typeof vi.fn>;

function mockRegistrantsResult(result: { data: unknown; error: unknown }) {
  const builder = makeQueryBuilder(result);
  mockSchema.mockReturnValue({ from: vi.fn().mockReturnValue(builder) });
  return builder;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getSuggestedEmailByMobile', () => {
  it('returns the matched registrant email', async () => {
    mockRegistrantsResult({ data: { email: 'alice@example.com' }, error: null });
    const result = await getSuggestedEmailByMobile('0412345678');
    expect(result).toBe('alice@example.com');
    expect(mockSchema).toHaveBeenCalledWith('registry');
  });

  it('returns null when no registrant matches', async () => {
    mockRegistrantsResult({ data: null, error: null });
    const result = await getSuggestedEmailByMobile('0412345678');
    expect(result).toBeNull();
  });

  it('returns null (never throws) on a query error', async () => {
    mockRegistrantsResult({ data: null, error: { code: '500', message: 'boom' } });
    const result = await getSuggestedEmailByMobile('0412345678');
    expect(result).toBeNull();
  });

  it('returns null without querying when the mobile does not normalize to a phone', async () => {
    const result = await getSuggestedEmailByMobile('');
    expect(result).toBeNull();
    expect(mockSchema).not.toHaveBeenCalled();
  });
});
