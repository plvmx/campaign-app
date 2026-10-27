import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import CampaignResultsClient from '@/app/public/campaign-results/CampaignResultsClient';

vi.mock('@/lib/reportCanvas', () => ({
  drawReportPage: vi.fn(() => ({})),
  canvasToJpegBlob: vi.fn(async () => new Blob(['x'])),
}));
vi.mock('@/lib/reportGenerator', () => ({ chunkReportRows: vi.fn(() => [[{}], [{}]]) }));

describe('CampaignResultsClient', () => {
  beforeEach(() => {
    URL.createObjectURL = vi.fn(() => 'blob:x');
    URL.revokeObjectURL = vi.fn();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ rows: [{}], weekStart: '2026-10-12' }),
    }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('public version keeps its JPEG download wording', async () => {
    render(<CampaignResultsClient />);
    await waitFor(() => expect(screen.getByText('Download JPEG for Page 1')).toBeTruthy());
  });

  it('in-app version has Download a Copy buttons, no Save to Photos, and a return link', async () => {
    const onClose = vi.fn();
    render(<CampaignResultsClient onClose={onClose} />);
    await waitFor(() => expect(screen.getByText('Download a Copy of Page 2')).toBeTruthy());
    expect(screen.getByText('Download a Copy of Page 1')).toBeTruthy();
    expect(screen.queryByText(/Save .*to Photos/)).toBeNull();
    expect(screen.queryByText('Tap a page below')).toBeNull();
    fireEvent.click(screen.getAllByText(/Return to the previous page/)[0]);
    expect(onClose).toHaveBeenCalled();
  });
});
