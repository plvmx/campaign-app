import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

const mockGetSession = vi.fn();
vi.mock('@/lib/registrySupabaseClient', () => ({
  registrySupabase: {
    auth: {
      getSession: (...args: unknown[]) => mockGetSession(...args),
    },
  },
}));

const mockUseRegistryGate = vi.fn();
vi.mock('@/app/registry/useRegistryGate', () => ({
  useRegistryGate: (...args: unknown[]) => mockUseRegistryGate(...args),
}));

import RegistryManageWhatsAppInviteLogPage from '../page';
import type { WhatsAppInviteLogEntry } from '@/lib/registryPipeline/manageSummaryTypes';

const PAGE_1_ENTRIES: WhatsAppInviteLogEntry[] = [
  {
    id: 3, status: 'sent', error: null, resendMessageId: 'msg-abc', includedCampaignsNearMeLink: true, attemptedAt: '2026-09-15T02:00:00Z',
    registrant: { firstName: 'Vicky', lastName: 'Vale', email: 'vicky@example.com', state: 'NSW' },
  },
  {
    id: 2, status: 'failed', error: 'Resend API error 500', resendMessageId: null, includedCampaignsNearMeLink: false, attemptedAt: '2026-09-15T01:00:00Z',
    registrant: { firstName: 'Bob', lastName: 'Brown', email: 'bob@example.com', state: 'VIC' },
  },
];

function installFetchMock(overrides: Partial<{ entries: WhatsAppInviteLogEntry[]; totalCount: number }> = {}) {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ entries: overrides.entries ?? PAGE_1_ENTRIES, totalCount: overrides.totalCount ?? PAGE_1_ENTRIES.length }),
  }) as unknown as typeof fetch;
}

describe('RegistryManageWhatsAppInviteLogPage', () => {
  beforeEach(() => {
    mockGetSession.mockReset().mockResolvedValue({ data: { session: { access_token: 'token-123' } } });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('shows a plain refusal to a state_leader, and never fetches', async () => {
    installFetchMock();
    mockUseRegistryGate.mockReturnValue({ status: 'ready', leaderRole: { role: 'state_leader', mfa_required: false } });
    render(<RegistryManageWhatsAppInviteLogPage />);
    expect(await screen.findByText(/only available to national registry admins/i)).toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('fetches page 1 with the session access token as a Bearer header', async () => {
    installFetchMock();
    mockUseRegistryGate.mockReturnValue({ status: 'ready', leaderRole: { role: 'national_admin', mfa_required: true } });
    render(<RegistryManageWhatsAppInviteLogPage />);
    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(
      '/api/registry/manage-whatsapp-invite-log?page=1',
      expect.objectContaining({ headers: { Authorization: 'Bearer token-123' } }),
    ));
  });

  it('renders a sent entry with its registrant, status, and Resend message id', async () => {
    installFetchMock();
    mockUseRegistryGate.mockReturnValue({ status: 'ready', leaderRole: { role: 'national_admin', mfa_required: true } });
    render(<RegistryManageWhatsAppInviteLogPage />);

    expect(await screen.findByText('Sent')).toBeInTheDocument();
    expect(screen.getByText('Vicky Vale (vicky@example.com)')).toBeInTheDocument();
    expect(screen.getByText('msg-abc')).toBeInTheDocument();
    expect(screen.getAllByText('Yes').length).toBeGreaterThan(0);
  });

  it('renders a failed entry with its error message, and no Resend id', async () => {
    installFetchMock();
    mockUseRegistryGate.mockReturnValue({ status: 'ready', leaderRole: { role: 'national_admin', mfa_required: true } });
    render(<RegistryManageWhatsAppInviteLogPage />);

    expect(await screen.findByText('Failed')).toBeInTheDocument();
    expect(screen.getByText('Resend API error 500')).toBeInTheDocument();
    expect(screen.getAllByText('No').length).toBeGreaterThan(0);
  });

  it('renders a skipped_no_link entry with its own label and an em dash for detail', async () => {
    installFetchMock({
      entries: [{ id: 9, status: 'skipped_no_link', error: null, resendMessageId: null, includedCampaignsNearMeLink: false, attemptedAt: '2026-09-15T03:00:00Z', registrant: { firstName: 'New', lastName: 'Person', email: 'new@example.com', state: 'QLD' } }],
      totalCount: 1,
    });
    mockUseRegistryGate.mockReturnValue({ status: 'ready', leaderRole: { role: 'national_admin', mfa_required: true } });
    render(<RegistryManageWhatsAppInviteLogPage />);

    expect(await screen.findByText('Skipped (no invite link configured)')).toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('falls back to "Unknown registrant" when the joined registrant is null', async () => {
    installFetchMock({
      entries: [{ id: 9, status: 'sent', error: null, resendMessageId: 'msg-xyz', includedCampaignsNearMeLink: false, attemptedAt: '2026-09-15T00:00:00Z', registrant: null }],
      totalCount: 1,
    });
    mockUseRegistryGate.mockReturnValue({ status: 'ready', leaderRole: { role: 'national_admin', mfa_required: true } });
    render(<RegistryManageWhatsAppInviteLogPage />);
    expect(await screen.findByText('Unknown registrant')).toBeInTheDocument();
  });

  it('pages forward and back, refetching each time', async () => {
    installFetchMock({ totalCount: 120 }); // 3 pages at PAGE_SIZE 50
    mockUseRegistryGate.mockReturnValue({ status: 'ready', leaderRole: { role: 'national_admin', mfa_required: true } });
    render(<RegistryManageWhatsAppInviteLogPage />);
    await screen.findByText('1 / 3');

    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(
      '/api/registry/manage-whatsapp-invite-log?page=2',
      expect.anything(),
    ));
    await screen.findByText('2 / 3');

    fireEvent.click(screen.getByRole('button', { name: /prev/i }));
    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(
      '/api/registry/manage-whatsapp-invite-log?page=1',
      expect.anything(),
    ));
  });

  it('shows a "no invite attempts recorded" message rather than an empty table when there are none', async () => {
    installFetchMock({ entries: [], totalCount: 0 });
    mockUseRegistryGate.mockReturnValue({ status: 'ready', leaderRole: { role: 'national_admin', mfa_required: true } });
    render(<RegistryManageWhatsAppInviteLogPage />);
    expect(await screen.findByText('No invite attempts recorded yet.')).toBeInTheDocument();
  });
});
