import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/supabaseClient', () => ({
  supabase: { from: vi.fn(), auth: {} },
}));

import { supabase } from '@/lib/supabaseClient';
import { makeQueryBuilder } from './supabaseMock';
import {
  getStatePlaces,
  createStatePlace,
  updateStatePlace,
  deleteStatePlace,
  setStatePlaceCoordinates,
} from '../statePlacesService';

const mockFrom = vi.mocked(supabase.from) as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getStatePlaces', () => {
  it('returns all places when no state filter is given', async () => {
    const builder = makeQueryBuilder({ data: [{ id: '1', state: 'VIC', place: 'Melbourne', created_at: '' }], error: null });
    mockFrom.mockReturnValue(builder);
    expect(await getStatePlaces()).toHaveLength(1);
    expect(builder.eq).not.toHaveBeenCalled();
  });

  it('filters by state when given one', async () => {
    const builder = makeQueryBuilder({ data: [], error: null });
    mockFrom.mockReturnValue(builder);
    await getStatePlaces('VIC');
    expect(builder.eq).toHaveBeenCalledWith('state', 'VIC');
  });

  it('throws on error', async () => {
    const error = { code: '500', message: 'boom' };
    mockFrom.mockReturnValue(makeQueryBuilder({ data: null, error }));
    await expect(getStatePlaces()).rejects.toEqual(error);
  });
});

describe('createStatePlace', () => {
  it('inserts the place', async () => {
    const builder = makeQueryBuilder({ data: null, error: null });
    mockFrom.mockReturnValue(builder);
    await createStatePlace({ state: 'VIC', place: 'Melbourne' });
    expect(builder.insert).toHaveBeenCalledWith([{ state: 'VIC', place: 'Melbourne' }]);
  });

  it('raises a friendly error on a duplicate state+place (23505)', async () => {
    mockFrom.mockReturnValue(makeQueryBuilder({ data: null, error: { code: '23505' } }));
    await expect(createStatePlace({ state: 'VIC', place: 'Melbourne' })).rejects.toThrow(
      'This state-place combination already exists',
    );
  });

  it('rethrows other errors as-is', async () => {
    const error = { code: '500', message: 'boom' };
    mockFrom.mockReturnValue(makeQueryBuilder({ data: null, error }));
    await expect(createStatePlace({ state: 'VIC', place: 'Melbourne' })).rejects.toEqual(error);
  });
});

describe('updateStatePlace', () => {
  it('updates by id', async () => {
    const builder = makeQueryBuilder({ data: null, error: null });
    mockFrom.mockReturnValue(builder);
    await updateStatePlace('p1', { state: 'VIC', place: 'Geelong' });
    expect(builder.update).toHaveBeenCalledWith({ state: 'VIC', place: 'Geelong' });
    expect(builder.eq).toHaveBeenCalledWith('id', 'p1');
  });

  it('throws on error', async () => {
    const error = { code: '500', message: 'boom' };
    mockFrom.mockReturnValue(makeQueryBuilder({ data: null, error }));
    await expect(updateStatePlace('p1', { state: 'VIC', place: 'Geelong' })).rejects.toEqual(error);
  });
});

describe('deleteStatePlace', () => {
  it('deletes by id', async () => {
    const builder = makeQueryBuilder({ data: null, error: null });
    mockFrom.mockReturnValue(builder);
    await deleteStatePlace('p1');
    expect(builder.eq).toHaveBeenCalledWith('id', 'p1');
  });

  it('throws on error', async () => {
    const error = { code: '500', message: 'boom' };
    mockFrom.mockReturnValue(makeQueryBuilder({ data: null, error }));
    await expect(deleteStatePlace('p1')).rejects.toEqual(error);
  });
});

describe('setStatePlaceCoordinates', () => {
  it('updates latitude/longitude by id', async () => {
    const builder = makeQueryBuilder({ data: null, error: null });
    mockFrom.mockReturnValue(builder);
    await setStatePlaceCoordinates('p1', { latitude: -37.8, longitude: 144.9 });
    expect(builder.update).toHaveBeenCalledWith({ latitude: -37.8, longitude: 144.9 });
    expect(builder.eq).toHaveBeenCalledWith('id', 'p1');
  });

  it('throws on error', async () => {
    const error = { code: '500', message: 'boom' };
    mockFrom.mockReturnValue(makeQueryBuilder({ data: null, error }));
    await expect(setStatePlaceCoordinates('p1', { latitude: 0, longitude: 0 })).rejects.toEqual(error);
  });
});
