import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

let mockSearch = '';
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(mockSearch),
}));

import BackToAppBar, { withBackToApp } from '../BackToAppBar';

afterEach(cleanup);

describe('BackToAppBar', () => {
  it('shows a link back to /app when the page was opened from the app', () => {
    mockSearch = new URL(withBackToApp('/public/week1-campaigns'), 'http://x').search;
    render(<BackToAppBar />);
    expect(screen.getByRole('link', { name: '← Back to app' }).getAttribute('href')).toBe('/app');
  });

  it.each(['', '?from=elsewhere'])('shows nothing for a shared link (query %j)', (search) => {
    mockSearch = search;
    render(<BackToAppBar />);
    expect(screen.queryByRole('link')).toBeNull();
  });
});
