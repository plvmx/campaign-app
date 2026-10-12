import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

const mockPush = vi.fn();
const mockRouter = { push: mockPush };
vi.mock('next/navigation', () => ({
  useRouter: () => mockRouter,
}));

import AdminQuickActions from '../AdminQuickActions';

afterEach(cleanup);

describe('AdminQuickActions', () => {
  it('offers only the registry lookup — no download buttons or state filter', () => {
    render(<AdminQuickActions />);

    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['Check if a Person is Registered']);
    expect(screen.queryByRole('combobox')).toBeNull();
  });

  it('opens the admin Registry Lookup', () => {
    render(<AdminQuickActions />);
    screen.getByRole('button', { name: 'Check if a Person is Registered' }).click();
    expect(mockPush).toHaveBeenCalledWith('/admin/check-registration');
  });
});
