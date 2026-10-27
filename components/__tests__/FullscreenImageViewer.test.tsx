import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import FullscreenImageViewer from '../FullscreenImageViewer';

afterEach(() => {
  cleanup();
  window.history.replaceState(null, '');
});

describe('FullscreenImageViewer — leaving the viewer on a phone', () => {
  it('shows a visibly labelled Close button, not just an icon', () => {
    render(<FullscreenImageViewer src="blob:x" alt="results" onClose={() => {}} />);
    expect(screen.getByRole('button', { name: /close full screen view/i })).toHaveTextContent('Close');
  });

  it('closes when the image itself is tapped', () => {
    const onClose = vi.fn();
    render(<FullscreenImageViewer src="blob:x" alt="results" onClose={onClose} />);
    fireEvent.click(screen.getByAltText('results'));
    // close() goes via history.back(); jsdom fires popstate asynchronously.
    return vi.waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it("closes on the phone's Back gesture (popstate) instead of leaving the page", () => {
    const onClose = vi.fn();
    render(<FullscreenImageViewer src="blob:x" alt="results" onClose={onClose} />);
    expect(window.history.state).toMatchObject({ fullscreenImageViewer: true });
    act(() => {
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not push another history entry when re-rendered with a new onClose', () => {
    const { rerender } = render(<FullscreenImageViewer src="blob:x" alt="results" onClose={() => {}} />);
    const lengthAfterOpen = window.history.length;
    rerender(<FullscreenImageViewer src="blob:x" alt="results" onClose={() => {}} />);
    expect(window.history.length).toBe(lengthAfterOpen);
  });
});
