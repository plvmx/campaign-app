/**
 * Regression test for the map-under-bottom-nav bug: the admin map pages size
 * their map container using `calc(100dvh - ... - var(--pwa-banner-height,0px))`,
 * relying on PWAInstallPrompt to publish its own rendered height as that CSS
 * custom property (see app/admin/campaign-map/page.tsx and friends). Before the
 * fix, nothing published that height, so the map's height calc had no way to
 * know the banner was pushing it down, and the map rendered underneath the
 * fixed bottom nav whenever the (dismissible, mobile-only-taller) banner showed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
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

  it('sets --pwa-banner-height to its own rendered height on mount', () => {
    render(<PWAInstallPrompt />);
    expect(bannerHeightVar()).toBe(`${BANNER_HEIGHT_PX}px`);
  });

  it('resets --pwa-banner-height to 0px when the user dismisses the banner', () => {
    render(<PWAInstallPrompt />);
    expect(bannerHeightVar()).toBe(`${BANNER_HEIGHT_PX}px`);

    fireEvent.click(screen.getByRole('button', { name: /dismiss install prompt/i }));

    expect(bannerHeightVar()).toBe('0px');
  });

  it('resets --pwa-banner-height to 0px on unmount', () => {
    const { unmount } = render(<PWAInstallPrompt />);
    expect(bannerHeightVar()).toBe(`${BANNER_HEIGHT_PX}px`);

    unmount();

    expect(bannerHeightVar()).toBe('0px');
  });

  it('never publishes a non-zero height when already installed (standalone)', () => {
    mockMatchMedia(true); // display-mode: standalone
    render(<PWAInstallPrompt />);
    expect(bannerHeightVar()).toBe('0px');
  });
});
