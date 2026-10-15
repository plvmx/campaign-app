import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

const mockPush = vi.fn();
const mockRouter = { push: mockPush };
vi.mock('next/navigation', () => ({
  useRouter: () => mockRouter,
}));

import AdminQuickActions from '../AdminQuickActions';

afterEach(() => {
  cleanup();
  mockPush.mockClear();
});

describe('AdminQuickActions', () => {
  it('offers the registry lookup and two public links — no download buttons or state filter', () => {
    render(<AdminQuickActions />);

    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual([
      'Check if a Person is Registered',
      'Week 1 Campaigns',
      'Campaign Results',
    ]);
    expect(screen.queryByRole('combobox')).toBeNull();
  });

  it('opens the admin Registry Lookup', () => {
    render(<AdminQuickActions />);
    screen.getByRole('button', { name: 'Check if a Person is Registered' }).click();
    expect(mockPush).toHaveBeenCalledWith('/admin/check-registration');
  });

  it.each([
    ['Week 1 Campaigns', '/public/week1-campaigns?from=app'],
    ['Campaign Results', '/public/campaign-results?from=app'],
  ])('opens the %s public link with a way back to the app', (name, path) => {
    render(<AdminQuickActions />);
    screen.getByRole('button', { name }).click();
    expect(mockPush).toHaveBeenCalledWith(path);
  });
});
