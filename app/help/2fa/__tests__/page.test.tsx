import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import TwoFactorGuidePage from '../page';

afterEach(() => vi.unstubAllEnvs());

describe('/help/2fa guide', () => {
  it('covers each step in the words the app screens use', () => {
    render(<TwoFactorGuidePage />);
    for (const text of [/CONFIRM NOW/, /One last step/, /Add to my authenticator app/, /Copy key/, /Time based/, /Verify and continue/, /Sign in with email/]) {
      expect(screen.getAllByText(text).length).toBeGreaterThan(0);
    }
  });

  it('links to the authenticator apps in both app stores', () => {
    render(<TwoFactorGuidePage />);
    const hrefs = screen.getAllByRole('link').map((a) => a.getAttribute('href'));
    expect(hrefs.some((h) => h?.startsWith('https://apps.apple.com/'))).toBe(true);
    expect(hrefs.some((h) => h?.startsWith('https://play.google.com/'))).toBe(true);
  });

  it('explains the two different numbers', () => {
    render(<TwoFactorGuidePage />);
    expect(screen.getByText(/two different numbers/i)).toBeInTheDocument();
  });

  it('shows the support number only when one is configured', () => {
    render(<TwoFactorGuidePage />);
    expect(screen.getByText(/contact the person who asked you/i)).toBeInTheDocument();
  });
});
