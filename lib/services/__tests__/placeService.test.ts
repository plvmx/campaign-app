import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/supabaseClient', () => ({
  supabase: { from: vi.fn(), auth: {} },
}));

import { supabase } from '@/lib/supabaseClient';
import { makeQueryBuilder } from './supabaseMock';
import { addNewPlaceForState } from '../placeService';

const mockFrom = vi.mocked(supabase.from) as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('addNewPlaceForState', () => {
  it('inserts the uppercased state and trimmed place', async () => {
    const builder = makeQueryBuilder({ data: null, error: null });
    mockFrom.mockReturnValue(builder);
    await addNewPlaceForState(' vic ', '  Melbourne  ');
    expect(builder.insert).toHaveBeenCalledWith([{ state: 'VIC', place: 'Melbourne' }]);
  });

  it('silently ignores a duplicate place (23505)', async () => {
    mockFrom.mockReturnValue(makeQueryBuilder({ data: null, error: { code: '23505', message: 'duplicate' } }));
    await expect(addNewPlaceForState('VIC', 'Melbourne')).resolves.toBeUndefined();
  });

  it('throws a descriptive error for any other failure', async () => {
    mockFrom.mockReturnValue(makeQueryBuilder({ data: null, error: { code: '42501', message: 'permission denied' } }));
    await expect(addNewPlaceForState('VIC', 'Melbourne')).rejects.toThrow(
      'Failed to add new place: permission denied',
    );
  });
});
