/**
 * New leaders can open the guide from the sign-in screen (Peter, 2026-10-15).
 * It opens in place, so Close returns to the form with what they'd typed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

const mockPush = vi.fn();
const mockRouter = { push: mockPush, replace: vi.fn() };
vi.mock('next/navigation', () => ({ useRouter: () => mockRouter }));
vi.mock('next/image', () => ({ default: () => null }));
vi.mock('@/contexts/UserContext', () => ({ useUser: () => ({ refresh: vi.fn() }) }));
vi.mock('@/lib/analytics', () => ({ trackEvent: vi.fn() }));
vi.mock('@/lib/supabaseClient', () => ({ supabase: { auth: {}, from: vi.fn() } }));
vi.mock('@/lib/emailConfirmSupabaseClient', () => ({ emailConfirmSupabase: { auth: {} } }));
vi.mock('@/lib/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth')>()),
  getVerifiedSession: vi.fn().mockResolvedValue(null),
}));
const mockFetchGuide = vi.fn();
vi.mock('@/lib/services/userGuideClient', () => ({ fetchUserGuide: () => mockFetchGuide() }));
vi.mock('@/components/PdfGuideViewer', () => ({ default: ({ url }: { url: string }) => <div data-testid="viewer">{url}</div> }));

import LoginPage from '../page';

beforeEach(() => {
  localStorage.clear();
  mockPush.mockReset();
  mockFetchGuide.mockResolvedValue({ url: 'https://signed/guide.pdf', uploadedAt: '2026-10-15T00:00:00.000Z' });
});
afterEach(() => cleanup());

describe('LoginPage — OPEN GUIDE', () => {
  it('opens the guide from the sign-in form without signing in, and Close returns to the form as it was', async () => {
    render(<LoginPage />);
    fireEvent.change(await screen.findByLabelText(/mobile number/i), { target: { value: '0400 000 000' } });

    // Low-key, same as the bottom-bar button: stacked gold label, no box.
    const button = screen.getByRole('button', { name: 'OPEN GUIDE' });
    expect(button.className).not.toMatch(/border|bg-white/);
    expect(button.querySelector('.text-amber-500')).toHaveTextContent('OPENGUIDE');

    fireEvent.click(button);
    expect(await screen.findByTestId('viewer')).toHaveTextContent('https://signed/guide.pdf');
    expect(mockPush).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(await screen.findByLabelText(/mobile number/i)).toHaveValue('0400 000 000');
  });

  // Removed 2026-10-15 (Peter): redundant — an enrolled admin who types
  // mobile+name is sent to email sign-in by the page itself, and a plain
  // leader is routed there when they open members' details.
  it('no longer shows the "Sign in with email instead" link on the sign-in form', async () => {
    render(<LoginPage />);
    await screen.findByLabelText(/mobile number/i);
    expect(screen.queryByText(/sign in with email instead/i)).toBeNull();
  });
});
