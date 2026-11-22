import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';

vi.mock('@/lib/supabaseClient', () => ({ supabase: { auth: {}, from: vi.fn() } }));
const push = vi.fn();
const router = { push }; // one stable object, like Next's router (a new one per render would re-run the page's loading effect)
vi.mock('next/navigation', () => ({
  useRouter: () => router,
  useSearchParams: () => new URLSearchParams('id=c1&returnFilter=past'),
}));
vi.mock('@/components/MobileLayout', () => ({ default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));

// A plain team leader (no admin status) — the page is now open to every leader who may record results.
let currentUser: { id: string } | null = { id: 'u1' };
vi.mock('@/contexts/UserContext', () => ({
  useUser: () => ({ user: currentUser, adminStatus: null, isLoading: false }),
}));

const fetchReport = vi.fn();
const submitReport = vi.fn();
vi.mock('@/lib/services/campaignReportClient', () => ({
  fetchCampaignReport: (...a: unknown[]) => fetchReport(...a),
  submitCampaignReport: (...a: unknown[]) => submitReport(...a),
}));

import Page from '../page';

const emptyView = {
  campaign: { location: 'Orange 1 VIC', leader: 'Jane Smith', date: '31/10/2026' },
  names: { partial: [], full: [], sinnersPrayers: [], followUp: [] },
  teamSize: null as number | null,
};

beforeEach(() => {
  localStorage.clear();
  currentUser = { id: 'u1' };
  fetchReport.mockResolvedValue(emptyView);
  submitReport.mockResolvedValue('sent');
  push.mockReset();
});
afterEach(() => { cleanup(); fetchReport.mockReset(); submitReport.mockReset(); });

describe('Campaign report entry page', () => {
  it('pre-fills location, leader and date and shows all four count fields', async () => {
    render(<Page />);
    expect(await screen.findByLabelText('Location')).toHaveValue('Orange 1 VIC');
    expect(screen.getByLabelText('Campaign Leader')).toHaveValue('Jane Smith');
    expect(screen.getByLabelText('Campaign Date')).toHaveValue('31/10/2026');
    for (const label of ['Partial Presentations', 'Full Presentations', 'Sinners Prayers', 'Requests for Follow-up/Info']) {
      expect(screen.getByLabelText(`Number of ${label} *`)).toBeInTheDocument();
    }
    expect(screen.getByRole('button', { name: 'Save & Submit' })).toBeInTheDocument();
  });

  it('limits counts to two digits and shows one name box per counted person', async () => {
    render(<Page />);
    const partial = await screen.findByLabelText('Number of Partial Presentations *');
    fireEvent.change(partial, { target: { value: 'x123' } });
    expect(partial).toHaveValue('12');
    await waitFor(() => expect(screen.getAllByPlaceholderText(/^Name \d+$/)).toHaveLength(12));
    fireEvent.change(partial, { target: { value: '3' } });
    expect(screen.getAllByPlaceholderText(/^Name \d+$/)).toHaveLength(3);
  });

  it('strips digits and symbols from names (keeps spaces) and caps at 20', async () => {
    render(<Page />);
    fireEvent.change(await screen.findByLabelText('Number of Full Presentations *'), { target: { value: '1' } });
    const name = screen.getByPlaceholderText('Name 1');
    fireEvent.change(name, { target: { value: 'Jo-hn Smith9!' + 'x'.repeat(30) } });
    expect((name as HTMLInputElement).value).toMatch(/^[A-Za-z ]{20}$/);
  });

  it('marks the pre-filled fields read-only with a shaded background and no star', async () => {
    render(<Page />);
    const location = await screen.findByLabelText('Location');
    expect(location).toHaveAttribute('readonly');
    expect(location.className).toContain('bg-gray-200');
    expect(screen.queryByText('Location *')).not.toBeInTheDocument();
  });

  it('requires a number in every count field when Save is clicked', async () => {
    render(<Page />);
    await screen.findByLabelText('Location');
    fireEvent.change(screen.getByLabelText('Team Size (including Leader) *'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('Number of Full Presentations *'), { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save & Submit' }));
    expect(screen.getAllByRole('alert')).toHaveLength(3);
    expect(screen.getByLabelText('Number of Partial Presentations *')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Number of Requests for Follow-up/Info *')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Number of Full Presentations *')).toHaveAttribute('aria-invalid', 'false');

    fireEvent.change(screen.getByLabelText('Number of Partial Presentations *'), { target: { value: '0' } });
    expect(screen.getAllByRole('alert')).toHaveLength(2);
    fireEvent.change(screen.getByLabelText('Number of Sinners Prayers *'), { target: { value: '0' } });
    fireEvent.change(screen.getByLabelText('Number of Requests for Follow-up/Info *'), { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save & Submit' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('requires a name in every revealed name box when Save is clicked', async () => {
    render(<Page />);
    await screen.findByLabelText('Location');
    fireEvent.change(screen.getByLabelText('Team Size (including Leader) *'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('Number of Partial Presentations *'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('Number of Full Presentations *'), { target: { value: '0' } });
    fireEvent.change(screen.getByLabelText('Number of Sinners Prayers *'), { target: { value: '0' } });
    fireEvent.change(screen.getByLabelText('Number of Requests for Follow-up/Info *'), { target: { value: '0' } });
    fireEvent.change(screen.getByLabelText('Number of Partial Presentations *'), { target: { value: '2' } });
    fireEvent.change(screen.getByPlaceholderText('Name 1'), { target: { value: 'Ann' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save & Submit' }));

    expect(screen.getByRole('alert')).toHaveTextContent('Please enter a name in every box.');
    expect(screen.getByPlaceholderText('Name 1')).toHaveAttribute('aria-invalid', 'false');
    expect(screen.getByPlaceholderText('Name 2')).toHaveAttribute('aria-invalid', 'true');

    fireEvent.change(screen.getByPlaceholderText('Name 2'), { target: { value: 'Bob' } });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  async function fillValidReport() {
    render(<Page />);
    await screen.findByLabelText('Location');
    fireEvent.change(screen.getByLabelText('Team Size (including Leader) *'), { target: { value: '3' } });
    fireEvent.change(screen.getByLabelText('Number of Partial Presentations *'), { target: { value: '0' } });
    fireEvent.change(screen.getByLabelText('Number of Full Presentations *'), { target: { value: '1' } });
    fireEvent.change(screen.getByPlaceholderText('Name 1'), { target: { value: 'Ann' } });
    fireEvent.change(screen.getByLabelText('Number of Sinners Prayers *'), { target: { value: '0' } });
    fireEvent.change(screen.getByLabelText('Number of Requests for Follow-up/Info *'), { target: { value: '0' } });
  }

  it('has a mandatory, digits-only Team Size box of two characters between Campaign Date and the counts', async () => {
    render(<Page />);
    const team = await screen.findByLabelText('Team Size (including Leader) *');
    fireEvent.change(team, { target: { value: 'a1b2c3' } });
    expect(team).toHaveValue('12');
    const order = [screen.getByLabelText('Campaign Date'), team, screen.getByLabelText('Number of Partial Presentations *')];
    expect(order[0].compareDocumentPosition(order[1]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(order[1].compareDocumentPosition(order[2]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    fireEvent.change(team, { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Number of Partial Presentations *'), { target: { value: '0' } });
    fireEvent.change(screen.getByLabelText('Number of Full Presentations *'), { target: { value: '0' } });
    fireEvent.change(screen.getByLabelText('Number of Sinners Prayers *'), { target: { value: '0' } });
    fireEvent.change(screen.getByLabelText('Number of Requests for Follow-up/Info *'), { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save & Submit' }));
    expect(team).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('alert')).toHaveTextContent('team size');
    expect(submitReport).not.toHaveBeenCalled();

    fireEvent.change(team, { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save & Submit' }));
    expect(team).toHaveAttribute('aria-invalid', 'true');
    fireEvent.change(team, { target: { value: '1' } });
    expect(team).toHaveAttribute('aria-invalid', 'false');
  });

  it('pre-fills the team size from the earlier saved report', async () => {
    fetchReport.mockResolvedValue({ ...emptyView, teamSize: 4 });
    render(<Page />);
    expect(await screen.findByLabelText('Team Size (including Leader) *')).toHaveValue('4');
  });

  describe('draft recovery (an iPhone can reload the page while the leader looks something up elsewhere)', () => {
    const DRAFT_KEY = 'afj_campaign_report_draft:c1';

    it('mirrors what is typed to the phone, and forgets it once the form is empty again', async () => {
      render(<Page />);
      fireEvent.change(await screen.findByLabelText('Team Size (including Leader) *'), { target: { value: '3' } });
      fireEvent.change(screen.getByLabelText('Number of Full Presentations *'), { target: { value: '1' } });
      fireEvent.change(screen.getByPlaceholderText('Name 1'), { target: { value: 'Ann' } });
      const saved = JSON.parse(localStorage.getItem(DRAFT_KEY)!);
      expect(saved).toMatchObject({ teamSize: '3', counts: { full: '1' }, names: { full: ['Ann'] } });
      fireEvent.change(screen.getByLabelText('Team Size (including Leader) *'), { target: { value: '' } });
      fireEvent.change(screen.getByLabelText('Number of Full Presentations *'), { target: { value: '' } });
      expect(localStorage.getItem(DRAFT_KEY)).toBeNull();
    });

    it('puts the typing back when the page is reloaded, with a note, ahead of what the server holds', async () => {
      fetchReport.mockResolvedValue({ ...emptyView, teamSize: 2, names: { ...emptyView.names, partial: ['Old'] } });
      localStorage.setItem(DRAFT_KEY, JSON.stringify({
        savedAt: Date.now(), teamSize: '4',
        counts: { partial: '', full: '2', sinnersPrayers: '0', followUp: '' },
        names: { partial: [], full: ['Bob', 'Cy'], sinnersPrayers: [], followUp: [] },
      }));
      render(<Page />);
      expect(await screen.findByLabelText('Team Size (including Leader) *')).toHaveValue('4');
      expect(screen.getByLabelText('Number of Full Presentations *')).toHaveValue('2');
      expect(screen.getByLabelText('Number of Partial Presentations *')).toHaveValue('');
      expect(screen.getByPlaceholderText('Name 1')).toHaveValue('Bob');
      expect(screen.getByPlaceholderText('Name 2')).toHaveValue('Cy');
      expect(screen.getByRole('status')).toHaveTextContent("We've put back what you had typed");
    });

    it('does not mirror untouched server-prefilled values (they could be out of date later)', async () => {
      fetchReport.mockResolvedValue({ ...emptyView, teamSize: 2 });
      render(<Page />);
      expect(await screen.findByLabelText('Team Size (including Leader) *')).toHaveValue('2');
      expect(localStorage.getItem(DRAFT_KEY)).toBeNull();
      expect(screen.queryByText(/put back what you had typed/)).not.toBeInTheDocument();
    });

    it('is cleared after a successful Save & Submit', async () => {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({
        savedAt: Date.now(), teamSize: '3',
        counts: { partial: '0', full: '1', sinnersPrayers: '0', followUp: '0' },
        names: { partial: [], full: ['Ann'], sinnersPrayers: [], followUp: [] },
      }));
      render(<Page />);
      await screen.findByLabelText('Team Size (including Leader) *');
      fireEvent.click(screen.getByRole('button', { name: 'Save & Submit' }));
      await screen.findByRole('region', { name: 'TWOL Campaign Summary' });
      expect(localStorage.getItem(DRAFT_KEY)).toBeNull();
    });

    it('is kept when saving fails, so nothing is lost', async () => {
      submitReport.mockRejectedValueOnce(new Error('The report could not be saved.'));
      await fillValidReport();
      fireEvent.click(screen.getByRole('button', { name: 'Save & Submit' }));
      await screen.findByText(/The report could not be saved/);
      expect(JSON.parse(localStorage.getItem(DRAFT_KEY)!)).toMatchObject({ teamSize: '3', names: { full: ['Ann'] } });
    });
  });

  it('does not save anything while the form is invalid', async () => {
    render(<Page />);
    await screen.findByLabelText('Location');
    fireEvent.click(screen.getByRole('button', { name: 'Save & Submit' }));
    expect(submitReport).not.toHaveBeenCalled();
  });

  it('saves the counts and the typed names through the server, and says when management was emailed', async () => {
    await fillValidReport();
    fireEvent.click(screen.getByRole('button', { name: 'Save & Submit' }));
    expect(await screen.findByText('Report saved and sent to management.')).toBeInTheDocument();
    expect(submitReport).toHaveBeenCalledWith(
      'c1',
      3,
      { partial: 0, full: 1, sinnersPrayers: 0, followUp: 0 },
      { partial: [], full: ['Ann'], sinnersPrayers: [], followUp: [] },
    );
  });

  it('shows the TWOL Campaign Summary after a successful save, with the same lines as the email and no names', async () => {
    await fillValidReport();
    fireEvent.click(screen.getByRole('button', { name: 'Save & Submit' }));
    const card = await screen.findByRole('region', { name: 'TWOL Campaign Summary' });
    expect(card).toHaveTextContent('TWOL Campaign Summary');
    for (const text of [
      'Location', 'Orange 1 VIC', 'Campaign Leader', 'Jane Smith (+2)', 'Campaign Date', '31/10/2026',
      'Number of Partial Presentations', 'Number of Full Presentations', 'Number of Sinners Prayers',
      'Number of Requests for Follow-up/Info',
    ]) expect(card).toHaveTextContent(text);
    // Not part of the screenshot-able card: the email's "submitted" intro and "sent automatically" footer, and names.
    expect(card).not.toHaveTextContent(/submitted|Sent automatically|Ann/);
    // The form is replaced, and the saved/sent message sits outside the card.
    expect(screen.queryByLabelText('Team Size (including Leader) *')).not.toBeInTheDocument();
    expect(screen.getByText('Report saved and sent to management.')).toBeInTheDocument();
    expect(card).not.toContainElement(screen.getByText('Report saved and sent to management.'));
  });

  it('does not show the summary when saving fails or the form is invalid', async () => {
    render(<Page />);
    await screen.findByLabelText('Location');
    fireEvent.click(screen.getByRole('button', { name: 'Save & Submit' }));
    expect(screen.queryByRole('region', { name: 'TWOL Campaign Summary' })).not.toBeInTheDocument();
    cleanup();
    submitReport.mockRejectedValueOnce(new Error('The report could not be saved.'));
    await fillValidReport();
    fireEvent.click(screen.getByRole('button', { name: 'Save & Submit' }));
    await screen.findByText(/The report could not be saved/);
    expect(screen.queryByRole('region', { name: 'TWOL Campaign Summary' })).not.toBeInTheDocument();
  });

  it('"Edit this report" goes back to the form with what was typed', async () => {
    await fillValidReport();
    fireEvent.click(screen.getByRole('button', { name: 'Save & Submit' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Edit this report' }));
    expect(screen.queryByRole('region', { name: 'TWOL Campaign Summary' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Team Size (including Leader) *')).toHaveValue('3');
    expect(screen.getByLabelText('Number of Full Presentations *')).toHaveValue('1');
  });

  it('just says "Report saved." when management emailing is switched off', async () => {
    submitReport.mockResolvedValue('disabled');
    await fillValidReport();
    fireEvent.click(screen.getByRole('button', { name: 'Save & Submit' }));
    expect(await screen.findByText('Report saved.')).toBeInTheDocument();
  });

  it('says the report was saved but the email failed, without an error that would prompt a re-save', async () => {
    submitReport.mockResolvedValue('failed');
    await fillValidReport();
    fireEvent.click(screen.getByRole('button', { name: 'Save & Submit' }));
    expect(await screen.findByText(/Report saved, but the email to management could not be sent/)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows an error and allows another try when saving fails', async () => {
    submitReport.mockRejectedValueOnce(new Error('The report could not be saved.'));
    await fillValidReport();
    fireEvent.click(screen.getByRole('button', { name: 'Save & Submit' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The report could not be saved. Please try again.');
    expect(screen.getByRole('button', { name: 'Save & Submit' })).not.toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Save & Submit' }));
    expect(await screen.findByText('Report saved and sent to management.')).toBeInTheDocument();
  });

  it('is open to a plain team leader: loads the campaign by id and is not bounced to /app', async () => {
    render(<Page />);
    expect(await screen.findByLabelText('Location')).toHaveValue('Orange 1 VIC');
    expect(fetchReport).toHaveBeenCalledWith('c1');
    expect(push).not.toHaveBeenCalled();
  });

  it('sends a signed-out visitor to the login page', async () => {
    currentUser = null;
    render(<Page />);
    await waitFor(() => expect(push).toHaveBeenCalledWith('/login'));
    expect(fetchReport).not.toHaveBeenCalled();
  });

  it('shows the server\'s message when the leader may not record results for the campaign', async () => {
    fetchReport.mockRejectedValue(new Error("You can't record results for this campaign."));
    render(<Page />);
    expect(await screen.findByText("You can't record results for this campaign.")).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save & Submit' })).not.toBeInTheDocument();
  });

  it('pre-fills the counts and name boxes from names already saved for the campaign, so they are edited not re-typed', async () => {
    fetchReport.mockResolvedValue({
      ...emptyView,
      names: { partial: ['Ann'], full: ['Bob', 'Cy Lee'], sinnersPrayers: [], followUp: [] },
    });
    render(<Page />);
    expect(await screen.findByLabelText('Number of Full Presentations *')).toHaveValue('2');
    expect(screen.getByLabelText('Number of Partial Presentations *')).toHaveValue('1');
    expect(screen.getByLabelText('Number of Sinners Prayers *')).toHaveValue('');
    expect(screen.getByLabelText('Number of Full Presentations — name 2')).toHaveValue('Cy Lee');
    expect(screen.getByLabelText('Number of Partial Presentations — name 1')).toHaveValue('Ann');
  });

  it('has the follow-up/info count, which reveals name boxes like the others', async () => {
    render(<Page />);
    const followUp = await screen.findByLabelText('Number of Requests for Follow-up/Info *');
    fireEvent.change(followUp, { target: { value: 'x25' } });
    expect(followUp).toHaveValue('25');
    fireEvent.change(followUp, { target: { value: '2' } });
    expect(screen.getAllByPlaceholderText(/^Name \d+$/)).toHaveLength(2);
    expect(screen.getByLabelText('Number of Requests for Follow-up/Info — name 1')).toBeInTheDocument();
  });
});
