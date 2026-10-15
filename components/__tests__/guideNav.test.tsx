/**
 * The "OPEN GUIDE" button (Peter, 2026-10-15): plain leaders get it in the
 * bottom bar between Home and My Admin — "OPEN" above "GUIDE", in bold gold —
 * and admins (AD/SR) don't.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

const mockAdmin = vi.fn();
vi.mock('next/navigation', () => ({ usePathname: () => '/app', useSearchParams: () => new URLSearchParams() }));
vi.mock('next/link', () => ({ default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }));
vi.mock('@/lib/auth', () => ({ signOut: vi.fn() }));
vi.mock('@/lib/campaignFilter', () => ({ getUserAdminStatusAndMobile: () => mockAdmin() }));
vi.mock('@/lib/supabaseClient', () => ({
  supabase: { auth: { getSession: vi.fn().mockResolvedValue({ data: { session: null } }) }, from: vi.fn() },
}));

import MobileLayout from '../MobileLayout';

afterEach(cleanup);

async function navLinks(): Promise<string[]> {
  render(<MobileLayout><p>content</p></MobileLayout>);
  await screen.findByText('Home');
  return Array.from(document.querySelectorAll('nav a')).map((a) => a.textContent ?? '');
}

describe('OPEN GUIDE nav button', () => {
  it('sits between Home and My Admin for a plain leader, linking to /app/guide', async () => {
    mockAdmin.mockResolvedValue({ admin: null, mobile: null });
    expect(await navLinks()).toEqual(['🏠Home', 'OPENGUIDE', '⚙️My Admin']);
    const open = screen.getByText('OPEN');
    expect(open.closest('a')).toHaveAttribute('href', '/app/guide');
    // Two stacked words, centred, in bold gold.
    expect(open.nextElementSibling).toHaveTextContent('GUIDE');
    expect(open.parentElement).toHaveClass('flex-col', 'items-center', 'font-extrabold', 'text-amber-500');
  });

  it.each(['AD', 'SR'])('is not shown to an admin (%s)', async (admin) => {
    mockAdmin.mockResolvedValue({ admin, mobile: null });
    expect(await navLinks()).not.toContain('OPENGUIDE');
  });
});
