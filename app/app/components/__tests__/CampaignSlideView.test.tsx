/**
 * Regression test: the in-app slide view (the "View" toggle on /app, also
 * enabled for the regular 'leaders' role via appSettings) rendered a Mobile
 * column for every campaign with no role check. Only full admins ('AD') and
 * state reporters ('SR') should see it.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

// CampaignSlideView pulls in lib/campaignFilter.ts -> lib/supabaseClient.ts,
// which requires real env vars at import time. Stub it out (unused here —
// this test only exercises isRecognizedAdminStatus, which needs no network
// access).
vi.mock('@/lib/supabaseClient', () => ({
  supabase: { auth: {}, from: vi.fn() },
}));

import CampaignSlideView from '../CampaignSlideView';
import type { Campaign } from '@/lib/types';

afterEach(cleanup);

const campaigns: Campaign[] = [
  {
    id: 'c1',
    date: '2020-01-01',
    state: 'VIC',
    place: 'Orange',
    site: '1',
    time: '10:00',
    leader: 'Jane Smith',
    mobile: '0400123456',
    category: 'TWOL',
    tl_ok: false,
    sr_ok: false,
    created_at: '2020-01-01T00:00:00.000Z',
  },
];

describe('CampaignSlideView — mobile number visibility', () => {
  it('hides the mobile column from a regular (non-admin, non-SR) user', () => {
    render(<CampaignSlideView campaigns={campaigns} adminStatus={null} />);
    expect(screen.queryByText('0400123456')).not.toBeInTheDocument();
  });

  it('shows the mobile column to a full admin', () => {
    render(<CampaignSlideView campaigns={campaigns} adminStatus="AD" />);
    expect(screen.getByText('0400123456')).toBeInTheDocument();
  });

  it('shows the mobile column to a state reporter', () => {
    render(<CampaignSlideView campaigns={campaigns} adminStatus="SR" />);
    expect(screen.getByText('0400123456')).toBeInTheDocument();
  });
});
