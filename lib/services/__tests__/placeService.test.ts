import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/supabaseClient', () => ({
  supabase: { from: vi.fn(), auth: {} },
}));

const mockGeocodePlace = vi.fn();
vi.mock('@/lib/geocoding', () => ({
  geocodePlace: (...args: unknown[]) => mockGeocodePlace(...args),
}));

import { supabase } from '@/lib/supabaseClient';
import { makeQueryBuilder } from './supabaseMock';
import { addNewPlaceForState } from '../placeService';

const mockFrom = vi.mocked(supabase.from) as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

// Regression coverage for the 2026-09-17 "state_places geocoding gap"
// incident: a place added via this path (a leader typing a brand-new
// place while creating a campaign) previously landed with no location or
// coordinates at all, silently invisible on the public Campaigns Near Me
// map (which never geocodes on demand) until someone noticed a campaign
// missing. addNewPlaceForState now best-effort geocodes at insert time.
describe('addNewPlaceForState', () => {
  it('inserts the uppercased state, trimmed place, and geocoded location/coordinates when geocoding succeeds', async () => {
    mockGeocodePlace.mockResolvedValue({ latitude: -37.8, longitude: 145.0 });
    const builder = makeQueryBuilder({ data: null, error: null });
    mockFrom.mockReturnValue(builder);

    await addNewPlaceForState(' vic ', '  Melbourne  ');

    expect(mockGeocodePlace).toHaveBeenCalledWith('Melbourne', 'VIC');
    expect(builder.insert).toHaveBeenCalledWith([
      { state: 'VIC', place: 'Melbourne', location: 'Melbourne', latitude: -37.8, longitude: 145.0 },
    ]);
  });

  it('inserts state+place only, with no location/coordinates, when geocoding finds nothing', async () => {
    mockGeocodePlace.mockResolvedValue(null);
    const builder = makeQueryBuilder({ data: null, error: null });
    mockFrom.mockReturnValue(builder);

    await addNewPlaceForState('VIC', 'Some Venue Name');

    expect(builder.insert).toHaveBeenCalledWith([{ state: 'VIC', place: 'Some Venue Name' }]);
  });

  it('silently ignores a duplicate place (23505)', async () => {
    mockGeocodePlace.mockResolvedValue(null);
    mockFrom.mockReturnValue(makeQueryBuilder({ data: null, error: { code: '23505', message: 'duplicate' } }));
    await expect(addNewPlaceForState('VIC', 'Melbourne')).resolves.toBeUndefined();
  });

  it('throws a descriptive error for any other failure', async () => {
    mockGeocodePlace.mockResolvedValue(null);
    mockFrom.mockReturnValue(makeQueryBuilder({ data: null, error: { code: '42501', message: 'permission denied' } }));
    await expect(addNewPlaceForState('VIC', 'Melbourne')).rejects.toThrow(
      'Failed to add new place: permission denied',
    );
  });
});
