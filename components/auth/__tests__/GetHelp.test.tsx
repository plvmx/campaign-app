import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { GetHelp } from '../GetHelp';
import { SetupStep } from '../SetupStep';

afterEach(() => { cleanup(); vi.unstubAllEnvs(); });

describe('GetHelp', () => {
  it('always links to the step-by-step guide (opens in a new tab so the setup page is not lost)', () => {
    render(<GetHelp />);
    const link = screen.getByRole('link', { name: /open the step-by-step guide/i });
    expect(link).toHaveAttribute('href', '/help/2fa');
    expect(link).toHaveAttribute('target', '_blank');
  });

  it('tells leaders to ask in the AFJ TWOL Leaders WhatsApp group, in bold, with no text-message link (sms: does nothing on a PC)', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPPORT_MOBILE', '0429 028 464');
    render(<GetHelp />);
    const bold = screen.getByText('ask for help on the AFJ TWOL Leaders WhatsApp group');
    expect(bold.tagName).toBe('STRONG');
    expect(screen.queryByRole('link', { name: /text us for help/i })).not.toBeInTheDocument();
    expect(document.querySelector('a[href^="sms:"]')).toBeNull();
  });
});

describe('SetupStep', () => {
  it('says how far along the person is', () => {
    render(<SetupStep n={2} label="Set up your authenticator app" />);
    expect(screen.getByText('Step 2 of 3: Set up your authenticator app')).toBeInTheDocument();
  });
});
