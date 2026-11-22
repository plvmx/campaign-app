/**
 * The loader must cost nothing for anyone who can't use Tech Insights: no
 * settings request and no key listener unless a full admin is on a desktop
 * device, and the panel only appears once the configured shortcut is pressed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent, act } from '@testing-library/react';

let mockUser = { isAdmin: true, isLoading: false };
vi.mock('@/contexts/UserContext', () => ({ useUser: () => mockUser }));

const mockGetConfig = vi.fn();
vi.mock('@/lib/appSettings', () => ({ getTechInsightsConfig: () => mockGetConfig() }));
vi.mock('../TechInsightsPanel', () => ({
  default: ({ onClose }: { onClose: () => void }) => <div role="dialog">panel<button onClick={onClose}>x</button></div>,
}));
vi.mock('next/dynamic', () => ({
  default: (loader: () => Promise<{ default: React.ComponentType<unknown> }>) => {
    // Resolve synchronously enough for tests: render the mocked panel directly.
    void loader;
    return (props: Record<string, unknown>) => <div role="dialog">panel<button onClick={props.onClose as () => void}>x</button></div>;
  },
}));

import TechInsightsLoader from '../TechInsightsLoader';

function setDesktop(desktop: boolean) {
  window.matchMedia = vi.fn().mockReturnValue({ matches: desktop }) as unknown as typeof window.matchMedia;
  Object.defineProperty(window, 'innerWidth', { value: desktop ? 1400 : 500, configurable: true });
}
const press = (init: KeyboardEventInit) => fireEvent.keyDown(window, init);
const CTRL_ALT_I = { code: 'KeyI', key: 'i', ctrlKey: true, altKey: true };

describe('TechInsightsLoader', () => {
  beforeEach(() => {
    mockUser = { isAdmin: true, isLoading: false };
    mockGetConfig.mockReset().mockResolvedValue({ enabled: true, hotkey: 'Ctrl+Alt+I' });
    setDesktop(true);
  });
  afterEach(cleanup);

  it('toggles the panel with the configured shortcut', async () => {
    render(<TechInsightsLoader />);
    await waitFor(() => expect(mockGetConfig).toHaveBeenCalled());
    await act(async () => {});
    press(CTRL_ALT_I);
    expect(await screen.findByRole('dialog')).toBeTruthy();
    press(CTRL_ALT_I);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('ignores other key presses', async () => {
    render(<TechInsightsLoader />);
    await act(async () => {});
    press({ code: 'KeyI', key: 'i', ctrlKey: true });
    press({ code: 'KeyJ', key: 'j', ctrlKey: true, altKey: true });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('does nothing for a non-admin — no settings request, no shortcut', async () => {
    mockUser = { isAdmin: false, isLoading: false };
    render(<TechInsightsLoader />);
    await act(async () => {});
    press(CTRL_ALT_I);
    expect(mockGetConfig).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('does nothing on a phone-sized or touch device, even for an admin', async () => {
    setDesktop(false);
    render(<TechInsightsLoader />);
    await act(async () => {});
    press(CTRL_ALT_I);
    expect(mockGetConfig).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('does nothing while the setting is off', async () => {
    mockGetConfig.mockResolvedValue({ enabled: false, hotkey: 'Ctrl+Alt+I' });
    render(<TechInsightsLoader />);
    await act(async () => {});
    press(CTRL_ALT_I);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('waits for the user to finish loading before deciding', async () => {
    mockUser = { isAdmin: false, isLoading: true };
    render(<TechInsightsLoader />);
    await act(async () => {});
    expect(mockGetConfig).not.toHaveBeenCalled();
  });
});
