import { describe, it, expect, vi } from 'vitest';
import { buildNewStatePlaceRow } from '../newStatePlace';

describe('buildNewStatePlaceRow', () => {
  it('always sets location to the place name, and adds coordinates found inside the state', async () => {
    const geocode = vi.fn().mockResolvedValue({ latitude: -38.1094, longitude: 147.0657 });
    expect(await buildNewStatePlaceRow(' vic ', '  Sale ', geocode)).toEqual({
      state: 'VIC', place: 'Sale', location: 'Sale', latitude: -38.1094, longitude: 147.0657,
    });
    expect(geocode).toHaveBeenCalledWith('Sale', 'VIC');
  });

  it('keeps the location text but no coordinates when nothing is found', async () => {
    expect(await buildNewStatePlaceRow('VIC', 'Some Venue', vi.fn().mockResolvedValue(null)))
      .toEqual({ state: 'VIC', place: 'Some Venue', location: 'Some Venue' });
  });

  it('rejects a result that is in the wrong state', async () => {
    const row = await buildNewStatePlaceRow('VIC', 'Brighton', vi.fn().mockResolvedValue({ latitude: -27.47, longitude: 153.03 }));
    expect(row.latitude).toBeUndefined();
    expect(row.location).toBe('Brighton');
  });

  it('survives the geocoder throwing', async () => {
    expect(await buildNewStatePlaceRow('SA', 'Marion', vi.fn().mockRejectedValue(new Error('network'))))
      .toEqual({ state: 'SA', place: 'Marion', location: 'Marion' });
  });
});
