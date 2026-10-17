/**
 * The banner only appears after hydration (it needs localStorage / the user
 * agent). Rendered in normal flow it pushed the whole page down when it mounted
 * — a layout shift on every first visit — so it is a fixed overlay instead:
 * nothing moves, and pages no longer need to know its height.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, act } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { hydrateRoot } from 'react-dom/client';
import PWAInstallPrompt from '../PWAInstallPrompt';

function mockMatchMedia(matches: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
}

describe('PWAInstallPrompt', () => {
  beforeEach(() => {
    localStorage.clear();

    mockMatchMedia(false); // not already installed/standalone
    Object.defineProperty(navigator, 'userAgent', {
      value: 'Mozilla/5.0 (Linux; Android 14)',
      configurable: true,
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('is a fixed overlay, not in normal flow, so showing it shifts no content', async () => {
    const { container } = render(<PWAInstallPrompt />);
    await waitFor(() => expect(screen.getByRole('button', { name: /dismiss install prompt/i })).toBeTruthy());
    const banner = container.firstElementChild as HTMLElement;
    expect(banner.className).toMatch(/\bfixed\b/);
  });

  it('is not shown when already installed (standalone)', async () => {
    mockMatchMedia(true); // display-mode: standalone
    render(<PWAInstallPrompt />);
    await act(async () => {});
    expect(screen.queryByRole('button', { name: /dismiss install prompt/i })).toBeNull();
  });

  it('stays hidden when the banner was previously dismissed', async () => {
    localStorage.setItem('pwa-install-dismissed-v2', '1');
    render(<PWAInstallPrompt />);
    await act(async () => {});
    expect(screen.queryByRole('button', { name: /dismiss install prompt/i })).toBeNull();
  });

  // Regression: the platform used to be read from window/localStorage in a lazy
  // useState initializer, so the first client render drew the banner while the
  // server (no window) rendered nothing -> "Hydration failed" in Next.js.
  describe('hydration', () => {
    it('renders nothing on the first render, even when the banner would show', () => {
      // jsdom has a window, so this exercises the "banner-eligible" first render.
      expect(renderToString(<PWAInstallPrompt />)).toBe('');
    });

    it('hydrates server HTML (empty) without a mismatch, then shows the banner', async () => {
      const container = document.createElement('div');
      document.body.appendChild(container);
      const onRecoverableError = vi.fn();
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

      let root!: ReturnType<typeof hydrateRoot>;
      await act(async () => {
        root = hydrateRoot(container, <PWAInstallPrompt />, { onRecoverableError });
      });

      await waitFor(() => expect(container.textContent).toMatch(/Install this app/));
      expect(onRecoverableError).not.toHaveBeenCalled();
      expect(consoleError).not.toHaveBeenCalled();

      act(() => root.unmount());
      container.remove();
    });
  });
});
