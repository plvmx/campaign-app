import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';

let authListener: ((event: string) => void) | undefined;
const getAuthenticatedUser = vi.fn();

vi.mock('@/lib/services/authService', () => ({
  getAuthenticatedUser: () => getAuthenticatedUser(),
}));
vi.mock('@/lib/supabaseClient', () => ({
  supabase: {
    auth: {
      onAuthStateChange: (cb: (event: string) => void) => {
        authListener = cb;
        return { data: { subscription: { unsubscribe: vi.fn() } } };
      },
    },
  },
}));

import { UserProvider, useUser } from '../UserContext';

function Probe() {
  const { isLoading } = useUser();
  return <div>{isLoading ? 'loading' : 'ready'}</div>;
}

describe('UserProvider loading state', () => {
  beforeEach(() => {
    authListener = undefined;
    getAuthenticatedUser.mockReset();
    getAuthenticatedUser.mockResolvedValue({
      user: { id: 'u1' }, profile: null, adminStatus: 'AD', isAdmin: true,
      userState: null, userLeader: null, userMobile: null,
    });
  });

  it('does not flip back to loading when the session is re-announced after the first load', async () => {
    render(<UserProvider><Probe /></UserProvider>);
    await waitFor(() => expect(screen.getByText('ready')).toBeTruthy());

    // Regression: SIGNED_IN fires again when the tab regains focus (file picker
    // closing); the spinner swap unmounted the admin page and lost the chosen file.
    let release: (v: unknown) => void = () => {};
    getAuthenticatedUser.mockReturnValue(new Promise((r) => { release = r; }));
    act(() => { authListener?.('SIGNED_IN'); });
    expect(screen.getByText('ready')).toBeTruthy();
    await act(async () => {
      release({ user: { id: 'u1' }, profile: null, adminStatus: 'AD', isAdmin: true, userState: null, userLeader: null, userMobile: null });
    });
    expect(screen.getByText('ready')).toBeTruthy();
  });
});
