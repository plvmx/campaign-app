import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { InlineCodeFallback } from '../InlineCodeFallback';

afterEach(() => vi.unstubAllGlobals());

function stubStandalone(standalone: boolean) {
  vi.stubGlobal('matchMedia', () => ({ matches: standalone }));
}

describe('InlineCodeFallback', () => {
  it('is collapsed behind "Click Here" in an ordinary browser tab', () => {
    stubStandalone(false);
    render(<InlineCodeFallback onVerify={vi.fn()} />);
    expect(screen.getByText('Click Here')).toBeTruthy();
    expect(screen.queryByLabelText(/Code from the email/)).toBeNull();
  });

  it('is open from the start, with a "don\'t tap the link" note, in an installed home-screen app', () => {
    stubStandalone(true);
    render(<InlineCodeFallback onVerify={vi.fn()} />);
    expect(screen.getByLabelText(/Code from the email/)).toBeTruthy();
    expect(screen.getByText(/please don.t tap the link/)).toBeTruthy();
  });
});
