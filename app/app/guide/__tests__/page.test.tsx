/**
 * OPEN GUIDE goes straight to the guide (no intermediate "Open the Guide"
 * screen) and has its own Close button (Peter, 2026-10-15).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

const mockBack = vi.fn();
const mockPush = vi.fn();
const mockFetchGuide = vi.fn();
let viewerProps: { url: string; onError: (e: unknown) => void } | null = null;

vi.mock('next/navigation', () => ({ useRouter: () => ({ back: mockBack, push: mockPush }) }));
vi.mock('@/contexts/UserContext', () => ({ useUser: () => ({ user: { id: 'u1' }, isLoading: false }) }));
vi.mock('@/lib/services/userGuideClient', () => ({ fetchUserGuide: () => mockFetchGuide() }));
vi.mock('@/components/PdfGuideViewer', () => ({
  default: (props: { url: string; onError: (e: unknown) => void }) => {
    viewerProps = props;
    return <div data-testid="viewer">{props.url}</div>;
  },
}));

import GuidePage from '../page';

const GUIDE = { url: 'https://signed/guide.pdf', uploadedAt: '2026-10-15T00:00:00.000Z' };

beforeEach(() => {
  vi.clearAllMocks();
  viewerProps = null;
});
afterEach(cleanup);

describe('/app/guide', () => {
  it('shows the guide straight away, with no extra button to press', async () => {
    mockFetchGuide.mockResolvedValue(GUIDE);
    render(<GuidePage />);
    expect(await screen.findByTestId('viewer')).toHaveTextContent(GUIDE.url);
    expect(screen.queryByText('Open the Guide')).toBeNull();
  });

  it('Close returns to the screen the leader came from', async () => {
    mockFetchGuide.mockResolvedValue(GUIDE);
    vi.spyOn(window.history, 'length', 'get').mockReturnValue(3);
    render(<GuidePage />);
    fireEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(mockBack).toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('Close goes home when there is nowhere to go back to', async () => {
    mockFetchGuide.mockResolvedValue(GUIDE);
    vi.spyOn(window.history, 'length', 'get').mockReturnValue(1);
    render(<GuidePage />);
    fireEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(mockPush).toHaveBeenCalledWith('/app');
  });

  it('offers the plain link if the guide cannot be drawn in the app', async () => {
    mockFetchGuide.mockResolvedValue(GUIDE);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(<GuidePage />);
    await screen.findByTestId('viewer');
    viewerProps!.onError(new Error('old phone'));
    const link = await screen.findByRole('link', { name: /open the guide in a new page/i });
    expect(link).toHaveAttribute('href', GUIDE.url);
    expect(screen.getByRole('button', { name: /close/i })).toBeInTheDocument();
  });

  it('says so when no guide has been uploaded', async () => {
    mockFetchGuide.mockResolvedValue(null);
    render(<GuidePage />);
    expect(await screen.findByText(/isn.t available yet/)).toBeInTheDocument();
  });
});
