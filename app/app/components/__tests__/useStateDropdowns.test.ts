import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

vi.mock('@/lib/services/dropdownService', () => ({
  getPlacesForState: vi.fn(),
  getLeadersForState: vi.fn(),
}));

import { getPlacesForState, getLeadersForState, type PlaceOption } from '@/lib/services/dropdownService';
import { useStateDropdowns } from '../useStateDropdowns';

const mockGetPlaces = vi.mocked(getPlacesForState);
const mockGetLeaders = vi.mocked(getLeadersForState);

/** Builds a bare PlaceOption (no site) for a place name — shorthand for these tests. */
function po(place: string): PlaceOption {
  return { place, site: '', label: place };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useStateDropdowns', () => {
  it('does not fetch when state is empty', () => {
    const { result } = renderHook(() => useStateDropdowns(''));
    expect(result.current.places).toEqual([]);
    expect(result.current.leaders).toEqual([]);
    expect(mockGetPlaces).not.toHaveBeenCalled();
    expect(mockGetLeaders).not.toHaveBeenCalled();
  });

  it('fetches places and leaders for the normalized (trimmed, uppercased) state', async () => {
    mockGetPlaces.mockResolvedValue([po('Melbourne'), po('Geelong')]);
    mockGetLeaders.mockResolvedValue(['Alice', 'Bob']);

    const { result } = renderHook(() => useStateDropdowns(' vic '));

    await waitFor(() => expect(result.current.loadingPlaces).toBe(false));
    await waitFor(() => expect(result.current.loadingLeaders).toBe(false));

    expect(mockGetPlaces).toHaveBeenCalledWith('VIC');
    expect(mockGetLeaders).toHaveBeenCalledWith('VIC');
    expect(result.current.places).toEqual([po('Melbourne'), po('Geelong')]);
    expect(result.current.leaders).toEqual(['Alice', 'Bob']);
  });

  it('caches per state — does not refetch on a re-render with the same state', async () => {
    mockGetPlaces.mockResolvedValue([po('Melbourne')]);
    mockGetLeaders.mockResolvedValue(['Alice']);

    const { result, rerender } = renderHook(({ state }) => useStateDropdowns(state), {
      initialProps: { state: 'VIC' },
    });
    await waitFor(() => expect(result.current.places).toEqual([po('Melbourne')]));

    rerender({ state: 'VIC' });
    await waitFor(() => expect(result.current.places).toEqual([po('Melbourne')]));

    expect(mockGetPlaces).toHaveBeenCalledTimes(1);
    expect(mockGetLeaders).toHaveBeenCalledTimes(1);
  });

  it('fetches fresh data when the state actually changes', async () => {
    mockGetPlaces.mockResolvedValueOnce([po('Melbourne')]).mockResolvedValueOnce([po('Sydney')]);
    mockGetLeaders.mockResolvedValue([]);

    const { result, rerender } = renderHook(({ state }) => useStateDropdowns(state), {
      initialProps: { state: 'VIC' },
    });
    await waitFor(() => expect(result.current.places).toEqual([po('Melbourne')]));

    rerender({ state: 'NSW' });
    await waitFor(() => expect(result.current.places).toEqual([po('Sydney')]));

    expect(mockGetPlaces).toHaveBeenCalledTimes(2);
    expect(mockGetPlaces).toHaveBeenNthCalledWith(2, 'NSW');
  });

  it('updatePlacesCache overwrites both the cache and the current places immediately', async () => {
    mockGetPlaces.mockResolvedValue([po('Melbourne')]);
    mockGetLeaders.mockResolvedValue([]);

    const { result } = renderHook(() => useStateDropdowns('VIC'));
    await waitFor(() => expect(result.current.places).toEqual([po('Melbourne')]));

    act(() => {
      result.current.updatePlacesCache('vic', [po('Melbourne'), po('Ballarat')]);
    });
    expect(result.current.places).toEqual([po('Melbourne'), po('Ballarat')]);
  });
});
