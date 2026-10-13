import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { GetHelp } from '../GetHelp';
import { SetupStep } from '../SetupStep';

afterEach(() => { cleanup(); vi.unstubAllEnvs(); });

describe('GetHelp', () => {
  it('always links to the step-by-step guide (opens in a new tab so the setup page is not lost)', () => {
    render(<GetHelp step="confirming my email" />);
    const link = screen.getByRole('link', { name: /open the step-by-step guide/i });
    expect(link).toHaveAttribute('href', '/help/2fa');
    expect(link).toHaveAttribute('target', '_blank');
    expect(screen.queryByRole('link', { name: /text us for help/i })).not.toBeInTheDocument();
  });

  it('adds a pre-filled text-message link when a support number is configured', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPPORT_MOBILE', '0429 028 464');
    render(<GetHelp step="typing the code from my app" who="Jack (NSW)" />);
    const href = screen.getByRole('link', { name: /text us for help/i }).getAttribute('href') ?? '';
    expect(href.startsWith('sms:+61429028464?&body=')).toBe(true);
    const body = decodeURIComponent(href.split('&body=')[1]);
    expect(body).toContain('Jack (NSW)');
    expect(body).toContain('typing the code from my app');
  });
});

describe('SetupStep', () => {
  it('says how far along the person is', () => {
    render(<SetupStep n={2} label="Set up your authenticator app" />);
    expect(screen.getByText('Step 2 of 3: Set up your authenticator app')).toBeInTheDocument();
  });
});
