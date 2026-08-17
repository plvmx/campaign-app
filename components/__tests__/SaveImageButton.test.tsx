import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import SaveImageButton from '../SaveImageButton';

const blob = new Blob(['fake-jpeg-bytes'], { type: 'image/jpeg' });

function mockShareSupport(supported: boolean) {
  Object.defineProperty(navigator, 'canShare', {
    writable: true,
    configurable: true,
    value: vi.fn().mockReturnValue(supported),
  });
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  // @ts-expect-error -- test-only cleanup of a property we defined ourselves
  delete navigator.canShare;
  // @ts-expect-error -- test-only cleanup of a property we defined ourselves
  delete navigator.share;
});

describe('SaveImageButton — unsupported browsers', () => {
  it('renders nothing when navigator.canShare is missing', () => {
    const { container } = render(<SaveImageButton blob={blob} filename="page1.jpeg" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when navigator.canShare returns false for this file', () => {
    mockShareSupport(false);
    const { container } = render(<SaveImageButton blob={blob} filename="page1.jpeg" />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('SaveImageButton — supported browsers', () => {
  beforeEach(() => {
    mockShareSupport(true);
  });

  it('renders the button and the "Save Image" hint', () => {
    render(<SaveImageButton blob={blob} filename="page1.jpeg" />);
    expect(screen.getByRole('button', { name: 'Save to Photos' })).toBeInTheDocument();
    expect(screen.getByText(/choose "Save Image"/i)).toBeInTheDocument();
  });

  it('uses a custom label when given one', () => {
    render(<SaveImageButton blob={blob} filename="page1.jpeg" label="Save Page 1 to Photos" />);
    expect(screen.getByRole('button', { name: 'Save Page 1 to Photos' })).toBeInTheDocument();
  });

  it('shares a File built from the blob/filename on click', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'share', { writable: true, configurable: true, value: share });

    render(<SaveImageButton blob={blob} filename="page1.jpeg" />);
    fireEvent.click(screen.getByRole('button', { name: 'Save to Photos' }));

    await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
    const sharedFile = share.mock.calls[0][0].files[0] as File;
    expect(sharedFile.name).toBe('page1.jpeg');
    expect(sharedFile.type).toBe('image/jpeg');
  });

  it('silently ignores the user cancelling the share sheet (AbortError)', async () => {
    const abortError = Object.assign(new Error('cancelled'), { name: 'AbortError' });
    const share = vi.fn().mockRejectedValue(abortError);
    Object.defineProperty(navigator, 'share', { writable: true, configurable: true, value: share });

    render(<SaveImageButton blob={blob} filename="page1.jpeg" />);
    fireEvent.click(screen.getByRole('button', { name: 'Save to Photos' }));

    await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(/could not open/i)).not.toBeInTheDocument();
  });

  it('shows an error message when navigator.share fails for a real reason', async () => {
    const share = vi.fn().mockRejectedValue(new Error('boom'));
    Object.defineProperty(navigator, 'share', { writable: true, configurable: true, value: share });

    render(<SaveImageButton blob={blob} filename="page1.jpeg" />);
    fireEvent.click(screen.getByRole('button', { name: 'Save to Photos' }));

    expect(await screen.findByText(/could not open save to photos/i)).toBeInTheDocument();
  });
});
