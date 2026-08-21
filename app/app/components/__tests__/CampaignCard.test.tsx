/**
 * Regression test: the main feed's campaign row rendered `campaign.mobile`
 * unconditionally, with no role check. Regular (non-admin, non-state-reporter)
 * leaders could see the mobile number on any campaign visible to them —
 * their own, and any leader's who had shared campaigns with them. Only
 * full admins ('AD') and state reporters ('SR') should see it.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

// CampaignCard pulls in lib/campaignFilter.ts -> lib/supabaseClient.ts, which
// requires real env vars at import time. Stub it out (unused here — this test
// only exercises isRecognizedAdminStatus, which needs no network access).
vi.mock('@/lib/supabaseClient', () => ({
  supabase: { auth: {}, from: vi.fn() },
}));

import CampaignCard from '../CampaignCard';
import type { Campaign } from '@/lib/types';

afterEach(cleanup);

const baseCampaign: Campaign = {
  id: 'c1',
  date: '2020-01-01', // safely in the past for isCampaignPast checks
  state: 'VIC',
  place: 'Orange',
  site: '1',
  time: '10:00',
  leader: 'Jane Smith',
  mobile: '0400 123 456',
  category: 'TWOL',
  tl_ok: false,
  sr_ok: false,
  created_at: '2020-01-01T00:00:00.000Z',
};

function renderCard(adminStatus: string | null, campaignInterestCount?: number) {
  return render(
    <CampaignCard
      campaign={baseCampaign}
      dateFilter="future"
      isAdmin={adminStatus === 'AD'}
      adminStatus={adminStatus}
      userState="VIC"
      userMobileAndLeader={null}
      sharedWithMeOwners={[]}
      savedCheckboxId={null}
      campaignInterestCount={campaignInterestCount}
      onEdit={() => {}}
      onDelete={() => {}}
      onToggleCheckbox={() => {}}
      onRecordResults={() => {}}
      onViewTrainingInterest={() => {}}
      onViewCampaignInterest={() => {}}
    />,
  );
}

describe('CampaignCard — mobile number visibility', () => {
  it('hides the mobile number from a regular (non-admin, non-SR) user', () => {
    renderCard(null);
    expect(screen.queryByText('0400 123 456')).not.toBeInTheDocument();
  });

  it('shows the mobile number to a full admin', () => {
    renderCard('AD');
    expect(screen.getByText('0400 123 456')).toBeInTheDocument();
  });

  it('shows the mobile number to a state reporter', () => {
    renderCard('SR');
    expect(screen.getByText('0400 123 456')).toBeInTheDocument();
  });
});

describe('CampaignCard — campaign interest callout', () => {
  it('is hidden when there is no registered interest', () => {
    renderCard(null, 0);
    expect(screen.queryByText(/interested/)).not.toBeInTheDocument();
    renderCard(null, undefined);
    expect(screen.queryByText(/interested/)).not.toBeInTheDocument();
  });

  it('shows a singular callout for exactly one registration', () => {
    renderCard(null, 1);
    expect(screen.getByText(/1 person interested/)).toBeInTheDocument();
  });

  it('shows a plural callout for more than one registration', () => {
    renderCard(null, 3);
    expect(screen.getByText(/3 people interested/)).toBeInTheDocument();
  });
});
