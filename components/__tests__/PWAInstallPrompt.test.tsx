/**
 * Regression test for the map-under-bottom-nav bug: the admin map pages size
 * their map container using `calc(100dvh - ... - var(--pwa-banner-height,0px))`,
 * relying on PWAInstallPrompt to publish its own rendered height as that CSS
 * custom property (see app/admin/campaigns-near-me/page.tsx and friends). Before
 * the fix, nothing published that height, so the map's height calc had no way to
 * know the banner was pushing it down, and the map rendered underneath the
 * fixed bottom nav whenever the (dismissible, mobile-only-taller) banner showed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { hydrateRoot } from 'react-dom/client';
import PWAInstallPrompt from '../PWAInstallPrompt';

const BANNER_HEIGHT_PX = 120;

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

function bannerHeightVar(): string {
  return document.documentElement.style.getPropertyValue('--pwa-banner-height');
}

describe('PWAInstallPrompt — publishes --pwa-banner-height', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.style.removeProperty('--pwa-banner-height');

    mockMatchMedia(false); // not already installed/standalone
    Object.defineProperty(navigator, 'userAgent', {
      value: 'Mozilla/5.0 (Linux; Android 14)',
      configurable: true,
    });

    // jsdom has no layout engine (offsetHeight is always 0) — force a realistic
    // rendered height so the effect under test has something real to publish.
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
      configurable: true,
      value: BANNER_HEIGHT_PX,
    });

    // jsdom doesn't implement ResizeObserver.
    window.ResizeObserver = class {
      observe() {}
      disconnect() {}
      unobserve() {}
    } as unknown as typeof ResizeObserver;
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('sets --pwa-banner-height to its own rendered height on mount', async () => {
    render(<PWAInstallPrompt />);
    await waitFor(() => expect(bannerHeightVar()).toBe(`${BANNER_HEIGHT_PX}px`));
  });

  it('resets --pwa-banner-height to 0px when the user dismisses the banner', async () => {
    render(<PWAInstallPrompt />);
    await waitFor(() => expect(bannerHeightVar()).toBe(`${BANNER_HEIGHT_PX}px`));

    fireEvent.click(screen.getByRole('button', { name: /dismiss install prompt/i }));

    expect(bannerHeightVar()).toBe('0px');
  });

  it('resets --pwa-banner-height to 0px on unmount', async () => {
    const { unmount } = render(<PWAInstallPrompt />);
    await waitFor(() => expect(bannerHeightVar()).toBe(`${BANNER_HEIGHT_PX}px`));

    unmount();

    expect(bannerHeightVar()).toBe('0px');
  });

  it('never publishes a non-zero height when already installed (standalone)', async () => {
    mockMatchMedia(true); // display-mode: standalone
    render(<PWAInstallPrompt />);
    await act(async () => {});
    expect(screen.queryByRole('button', { name: /dismiss install prompt/i })).toBeNull();
    expect(bannerHeightVar()).toBe('0px');
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
