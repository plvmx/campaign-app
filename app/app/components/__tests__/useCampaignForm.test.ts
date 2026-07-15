import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

vi.mock('@/lib/services/dropdownService', () => ({
  getPlacesForState: vi.fn(),
  getLeadersForState: vi.fn(),
  getLeaderMobile: vi.fn(),
}));
vi.mock('@/lib/services/placeService', () => ({
  addNewPlaceForState: vi.fn(),
}));

import {
  getPlacesForState,
  getLeadersForState,
  getLeaderMobile,
} from '@/lib/services/dropdownService';
import { addNewPlaceForState } from '@/lib/services/placeService';
import { useCampaignForm, type CampaignFormValues } from '../useCampaignForm';

const mockGetPlaces = vi.mocked(getPlacesForState);
const mockGetLeaders = vi.mocked(getLeadersForState);
const mockGetLeaderMobile = vi.mocked(getLeaderMobile);
const mockAddNewPlace = vi.mocked(addNewPlaceForState);

function baseValues(overrides: Partial<CampaignFormValues> = {}): CampaignFormValues {
  return {
    date: '2026-01-05',
    state: 'VIC',
    place: 'Melbourne',
    site: '',
    time: '10:00',
    leader: 'Sam',
    mobile: '',
    category: 'TWOL',
    tl_ok: false,
    sr_ok: false,
    ...overrides,
  };
}

function makeSubmitEvent() {
  return { preventDefault: vi.fn() } as unknown as React.FormEvent;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetPlaces.mockResolvedValue([]);
  mockGetLeaders.mockResolvedValue([]);
});

describe('useCampaignForm — field setters', () => {
  it('setValue updates a single field without touching the rest', () => {
    const onSubmit = vi.fn();
    const { result } = renderHook(() =>
      useCampaignForm({ initialValues: baseValues(), onSubmit }),
    );
    act(() => result.current.setValue('time', '11:00'));
    expect(result.current.values.time).toBe('11:00');
    expect(result.current.values.place).toBe('Melbourne');
  });

  it('handleStateChange resets place/leader/mobile and clears custom-place mode', () => {
    const onSubmit = vi.fn();
    const { result } = renderHook(() =>
      useCampaignForm({ initialValues: baseValues({ leader: 'Alice', mobile: '0412345678' }), onSubmit }),
    );
    act(() => result.current.handlePlaceChange('OTHER_PLACE'));
    expect(result.current.isOtherPlace).toBe(true);

    act(() => result.current.handleStateChange('NSW'));
    expect(result.current.values).toMatchObject({ state: 'NSW', place: '', site: '', leader: '', mobile: '' });
    expect(result.current.isOtherPlace).toBe(false);
    expect(result.current.customPlace).toBe('');
  });

  it('handlePlaceChange with OTHER_PLACE enters custom-place mode and clears leader/mobile', () => {
    const onSubmit = vi.fn();
    const { result } = renderHook(() =>
      useCampaignForm({ initialValues: baseValues({ leader: 'Alice', mobile: '0412345678' }), onSubmit }),
    );
    act(() => result.current.handlePlaceChange('OTHER_PLACE'));
    expect(result.current.isOtherPlace).toBe(true);
    expect(result.current.values).toMatchObject({ place: '', leader: '', mobile: '' });
  });

  it('handlePlaceChange with a real place exits custom-place mode and clears leader/mobile', () => {
    const onSubmit = vi.fn();
    const { result } = renderHook(() =>
      useCampaignForm({ initialValues: baseValues({ leader: 'Alice', mobile: '0412345678' }), onSubmit }),
    );
    act(() => result.current.handlePlaceChange('OTHER_PLACE'));
    act(() => result.current.handlePlaceChange('Geelong'));
    expect(result.current.isOtherPlace).toBe(false);
    expect(result.current.values).toMatchObject({ place: 'Geelong', leader: '', mobile: '' });
  });

  it('handleLeaderChange looks up and fills in the mobile number for a chosen leader', async () => {
    mockGetLeaderMobile.mockResolvedValue('0412345678');
    const onSubmit = vi.fn();
    const { result } = renderHook(() =>
      useCampaignForm({ initialValues: baseValues(), onSubmit }),
    );
    await act(async () => {
      await result.current.handleLeaderChange('Alice');
    });
    expect(mockGetLeaderMobile).toHaveBeenCalledWith('VIC', 'Alice');
    expect(result.current.values).toMatchObject({ leader: 'Alice', mobile: '0412345678' });
  });

  it('handleLeaderChange with an empty leader clears leader/mobile without querying', async () => {
    const onSubmit = vi.fn();
    const { result } = renderHook(() =>
      useCampaignForm({ initialValues: baseValues({ leader: 'Alice', mobile: '0412345678' }), onSubmit }),
    );
    await act(async () => {
      await result.current.handleLeaderChange('');
    });
    expect(mockGetLeaderMobile).not.toHaveBeenCalled();
    expect(result.current.values).toMatchObject({ leader: '', mobile: '' });
  });
});

describe('useCampaignForm — handleSubmit', () => {
  it('submits the resolved values on success', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useCampaignForm({ initialValues: baseValues(), onSubmit }),
    );
    await act(async () => {
      await result.current.handleSubmit(makeSubmitEvent());
    });
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ place: 'Melbourne' }));
    expect(result.current.error).toBeNull();
    expect(result.current.isSubmitting).toBe(false);
  });

  it('errors when no place is selected or entered', async () => {
    const onSubmit = vi.fn();
    const { result } = renderHook(() =>
      useCampaignForm({ initialValues: baseValues({ place: '' }), onSubmit }),
    );
    await act(async () => {
      await result.current.handleSubmit(makeSubmitEvent());
    });
    expect(onSubmit).not.toHaveBeenCalled();
    expect(result.current.error).toBe('Please select or enter a place');
  });

  it('errors when entering a custom place without a state selected', async () => {
    const onSubmit = vi.fn();
    const { result } = renderHook(() =>
      useCampaignForm({ initialValues: baseValues({ state: '', place: '' }), onSubmit }),
    );
    act(() => result.current.handlePlaceChange('OTHER_PLACE'));
    act(() => result.current.setCustomPlace('New Place'));
    await act(async () => {
      await result.current.handleSubmit(makeSubmitEvent());
    });
    expect(mockAddNewPlace).not.toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
    expect(result.current.error).toBe('Please select a state before entering a new place');
  });

  it('persists a custom place, refreshes the places cache, and submits with the new place', async () => {
    mockAddNewPlace.mockResolvedValue(undefined);
    mockGetPlaces.mockResolvedValue([
      { place: 'Ballarat', site: '', label: 'Ballarat' },
      { place: 'New Place', site: '', label: 'New Place' },
    ]);
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useCampaignForm({ initialValues: baseValues({ place: '' }), onSubmit }),
    );
    act(() => result.current.handlePlaceChange('OTHER_PLACE'));
    act(() => result.current.setCustomPlace('  New Place  '));
    act(() => result.current.setValue('leader', 'Sam'));

    await act(async () => {
      await result.current.handleSubmit(makeSubmitEvent());
    });

    expect(mockAddNewPlace).toHaveBeenCalledWith('VIC', 'New Place', '');
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ place: 'New Place', site: '' }));
  });

  it('splits a trailing numeric suffix off a custom place into site', async () => {
    mockAddNewPlace.mockResolvedValue(undefined);
    mockGetPlaces.mockResolvedValue([]);
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useCampaignForm({ initialValues: baseValues({ place: '' }), onSubmit }),
    );
    act(() => result.current.handlePlaceChange('OTHER_PLACE'));
    act(() => result.current.setCustomPlace('Somewhere 5'));
    act(() => result.current.setValue('leader', 'Sam'));

    await act(async () => {
      await result.current.handleSubmit(makeSubmitEvent());
    });

    expect(mockAddNewPlace).toHaveBeenCalledWith('VIC', 'Somewhere', '5');
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ place: 'Somewhere', site: '5' }));
  });

  it('errors when no leader is selected, even when submitted via a MouseEvent (InlineEditForm has no <form>)', async () => {
    const onSubmit = vi.fn();
    const { result } = renderHook(() =>
      useCampaignForm({ initialValues: baseValues({ leader: '' }), onSubmit }),
    );
    await act(async () => {
      await result.current.handleSubmit({ preventDefault: vi.fn() } as unknown as React.MouseEvent);
    });
    expect(onSubmit).not.toHaveBeenCalled();
    expect(result.current.error).toBe('Please select a leader');
  });

  it('surfaces the real error message and resets isSubmitting when onSubmit throws', async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error('Network error'));
    const { result } = renderHook(() =>
      useCampaignForm({ initialValues: baseValues(), onSubmit }),
    );
    await act(async () => {
      await result.current.handleSubmit(makeSubmitEvent());
    });
    expect(result.current.error).toBe('Network error');
    expect(result.current.isSubmitting).toBe(false);
  });
});

describe('useCampaignForm — auto-fill for non-admin users', () => {
  it('fills in leader/mobile once the leaders list loads and the leader matches', async () => {
    mockGetLeaders.mockResolvedValue(['Alice', 'Bob']);
    const onSubmit = vi.fn();
    const { result } = renderHook(() =>
      useCampaignForm({
        initialValues: baseValues({ leader: '' }),
        onSubmit,
        autoFill: {
          isAdmin: false,
          userMobileAndLeader: { mobile: '0412345678', leader: 'Alice' },
          userState: 'VIC',
        },
      }),
    );
    await waitFor(() => expect(result.current.values.leader).toBe('Alice'));
    expect(result.current.values.mobile).toBe('0412345678');
  });

  it('does not auto-fill for admins', async () => {
    mockGetLeaders.mockResolvedValue(['Alice']);
    const onSubmit = vi.fn();
    const { result } = renderHook(() =>
      useCampaignForm({
        initialValues: baseValues({ leader: '' }),
        onSubmit,
        autoFill: {
          isAdmin: true,
          userMobileAndLeader: { mobile: '0412345678', leader: 'Alice' },
          userState: 'VIC',
        },
      }),
    );
    await waitFor(() => expect(mockGetLeaders).toHaveBeenCalled());
    expect(result.current.values.leader).toBe('');
  });

  it('does not overwrite an already-chosen leader', async () => {
    mockGetLeaders.mockResolvedValue(['Alice', 'Bob']);
    const onSubmit = vi.fn();
    const { result } = renderHook(() =>
      useCampaignForm({
        initialValues: baseValues({ leader: 'Bob', mobile: '0499999999' }),
        onSubmit,
        autoFill: {
          isAdmin: false,
          userMobileAndLeader: { mobile: '0412345678', leader: 'Alice' },
          userState: 'VIC',
        },
      }),
    );
    await waitFor(() => expect(mockGetLeaders).toHaveBeenCalled());
    expect(result.current.values.leader).toBe('Bob');
    expect(result.current.values.mobile).toBe('0499999999');
  });

  it('does not auto-fill a leader name that is not in the fetched leaders list for that state', async () => {
    mockGetLeaders.mockResolvedValue(['Bob']); // 'Alice' is not registered in this state
    const onSubmit = vi.fn();
    const { result } = renderHook(() =>
      useCampaignForm({
        initialValues: baseValues({ leader: '' }),
        onSubmit,
        autoFill: {
          isAdmin: false,
          userMobileAndLeader: { mobile: '0412345678', leader: 'Alice' },
          userState: 'VIC',
        },
      }),
    );
    await waitFor(() => expect(mockGetLeaders).toHaveBeenCalled());
    expect(result.current.values.leader).toBe('');
  });
});
