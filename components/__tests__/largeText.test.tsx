/**
 * Larger text for older leaders (Peter, 2026-10-14): a `large-text` wrapper scales
 * every Tailwind text size (app/globals.css). Leader screens (MobileLayout's main
 * area), the public section and modals get it; /admin (dense tables) does not.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

let mockPathname = '/app';
vi.mock('next/navigation', () => ({ usePathname: () => mockPathname, useSearchParams: () => new URLSearchParams() }));
vi.mock('next/link', () => ({ default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }));
vi.mock('@/lib/auth', () => ({ signOut: vi.fn() }));
vi.mock('@/contexts/UserContext', () => ({ useUser: () => ({ adminStatus: null, isLoading: false }) }));
vi.mock('@/lib/supabaseClient', () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
    },
    from: vi.fn(),
  },
}));

import MobileLayout from '../MobileLayout';
import PublicLayout from '@/app/public/layout';
import Modal from '../Modal';

afterEach(cleanup);

describe('large text scope', () => {
  it('applies to the main area of leader screens', () => {
    mockPathname = '/app';
    render(<MobileLayout><p>content</p></MobileLayout>);
    expect(screen.getByText('content').closest('main')).toHaveClass('large-text');
  });

  it('does not apply to admin screens', () => {
    mockPathname = '/admin/state-leaders';
    render(<MobileLayout><p>content</p></MobileLayout>);
    expect(screen.getByText('content').closest('main')).not.toHaveClass('large-text');
  });

  it('applies to every public page via the public layout', () => {
    render(<PublicLayout><p>public</p></PublicLayout>);
    expect(screen.getByText('public').parentElement).toHaveClass('large-text');
  });

  it('applies to modals (which render outside the page, in document.body)', () => {
    render(<Modal onClose={() => undefined}><p>inside modal</p></Modal>);
    expect(screen.getByText('inside modal').parentElement).toHaveClass('large-text');
  });
});

describe('globals.css scale', () => {
  const css = readFileSync(join(__dirname, '../../app/globals.css'), 'utf8');
  const scale: Array<[string, number]> = [['xs', 16], ['sm', 18], ['base', 20], ['lg', 22], ['xl', 24], ['2xl', 28], ['3xl', 34]];

  it.each(scale)('raises text-%s to at least %ipx', (name, minPx) => {
    const m = css.match(new RegExp(`\\.large-text \\.text-${name}\\s*\\{\\s*font-size:\\s*([\\d.]+)rem`));
    if (!m) throw new Error(`missing .large-text .text-${name} rule`);
    expect(parseFloat(m[1]) * 16).toBeGreaterThanOrEqual(minPx);
  });

  it('keeps the overrides unlayered, so they beat Tailwind\'s layered utilities', () => {
    const after = css.slice(css.indexOf('.large-text .text-xs'));
    expect(after).not.toMatch(/@layer/);
  });
});
