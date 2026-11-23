import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react';

const replace = vi.fn();
const router = { replace }; // stable, like Next's own router object
let search = '';
vi.mock('next/navigation', () => ({
  useRouter: () => router,
  useSearchParams: () => new URLSearchParams(search),
}));

const fetchMemberMe = vi.fn();
const fetchMemberInvite = vi.fn();
const requestMemberCodes = vi.fn();
const verifyMemberCodes = vi.fn();
vi.mock('@/lib/memberAuthClient', () => ({
  fetchMemberMe: (...a: unknown[]) => fetchMemberMe(...a),
  fetchMemberInvite: (...a: unknown[]) => fetchMemberInvite(...a),
  requestMemberCodes: (...a: unknown[]) => requestMemberCodes(...a),
  verifyMemberCodes: (...a: unknown[]) => verifyMemberCodes(...a),
}));

import MemberSignIn from '../MemberSignIn';

// The full suite runs hundreds of files in parallel; a loaded machine can exceed the 1 s findBy / 5 s test defaults.
vi.setConfig({ testTimeout: 20_000 });
const WAIT = { timeout: 8_000 };
import { MEMBER_PENDING_KEY } from '@/lib/memberPendingSignIn';

const VID = '11111111-1111-4111-8111-111111111111';
const SENT = { status: 'sent', verificationId: VID, maskedEmail: 'j•••@gmail.com', maskedMobile: '04•• ••• 678' };

beforeEach(() => {
  search = '';
  localStorage.clear();
  for (const m of [replace, fetchMemberMe, fetchMemberInvite, requestMemberCodes, verifyMemberCodes]) m.mockReset();
  fetchMemberMe.mockResolvedValue({ status: 'signed_out' });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

const type = (label: RegExp | string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const click = (name: RegExp | string) => fireEvent.click(screen.getByRole('button', { name }));

async function openTyped() {
  render(<MemberSignIn />);
  await screen.findByRole('heading', { name: 'Welcome to the AFJ Member Portal' }, WAIT);
}
async function reachCodes() {
  requestMemberCodes.mockResolvedValue(SENT);
  await openTyped();
  type('Your email address', 'jane@gmail.com');
  type('Your mobile number', '0412 345 678');
  click('Send my codes');
  await screen.findByRole('heading', { name: 'Enter your codes' }, WAIT);
}

describe('nothing arrived', () => {
  it('tells the member what to check without saying whether they are registered', async () => {
    await reachCodes();
    expect(screen.getByText(/Nothing arrived\? Check your junk or spam folder/)).toBeInTheDocument();
    expect(screen.getByText(/email address and mobile number you registered with/)).toBeInTheDocument();
    expect(screen.queryByText(/not registered|couldn't find|no record/i)).not.toBeInTheDocument();
  });
});

describe('branding', () => {
  it('shows the AFJ banner on the sign-in screen, with a text alternative', async () => {
    await openTyped();
    const banner = screen.getByRole('img', { name: 'Australia For Jesus — Bringing Others to Christ' });
    expect(banner).toBeInTheDocument();
    expect(banner.getAttribute('src')).toContain('afj-logo-reversed.svg');
  });

  it('keeps the banner on the later screens too (code boxes), so the page looks the same throughout', async () => {
    await reachCodes();
    expect(screen.getByRole('img', { name: /Australia For Jesus/ })).toBeInTheDocument();
  });

  it('highlights "sign you in" in bold in the explanation', async () => {
    await openTyped();
    const bold = [...document.querySelectorAll('strong')].map((e) => e.textContent);
    expect(bold).toContain('sign you in');
    expect(document.body.textContent).toMatch(/To sign you in and keep your information safe/);
  });
});

describe('typed sign-in details', () => {
  it('shows the explanation and never uses technical jargon', async () => {
    await openTyped();
    expect(document.body.textContent).toMatch(/keep your information safe/);
    expect(document.body.textContent).not.toMatch(/2fa|mfa|authenticator|two-factor|verification code/i);
  });

  it('checks the whole form on submit: both fields flagged, nothing sent', async () => {
    await openTyped();
    click('Send my codes');
    const email = screen.getByLabelText('Your email address');
    const mobile = screen.getByLabelText('Your mobile number');
    expect(email).toHaveAttribute('aria-invalid', 'true');
    expect(mobile).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getAllByRole('alert').map((a) => a.textContent)).toEqual([
      'Please enter your email address.', 'Please enter your mobile number.',
    ]);
    expect(requestMemberCodes).not.toHaveBeenCalled();
  });

  it('flags a bad email and a non-mobile number, and clears each message as soon as it is fixed', async () => {
    await openTyped();
    type('Your email address', 'jane@');
    type('Your mobile number', '0212345678');
    click('Send my codes');
    expect(screen.getByText(/check your email address/)).toBeInTheDocument();
    expect(screen.getByText(/check your mobile number/)).toBeInTheDocument();
    expect(requestMemberCodes).not.toHaveBeenCalled();

    type('Your email address', 'jane@gmail.com');
    expect(screen.queryByText(/check your email address/)).not.toBeInTheDocument();
    expect(screen.getByLabelText('Your email address')).not.toHaveAttribute('aria-invalid');
    expect(screen.getByText(/check your mobile number/)).toBeInTheDocument();
  });

  it('restricts what can be typed: no spaces in the email, no letters in the mobile', async () => {
    await openTyped();
    type('Your email address', 'jane @gmail.com');
    type('Your mobile number', '04ab12-345');
    expect(screen.getByLabelText('Your email address')).toHaveValue('jane@gmail.com');
    expect(screen.getByLabelText('Your mobile number')).toHaveValue('0412345');
  });

  it('sends trimmed details and moves to the code boxes', async () => {
    await reachCodes();
    expect(requestMemberCodes).toHaveBeenCalledWith({ email: 'jane@gmail.com', mobile: '0412 345 678' });
    expect(screen.getByText('j•••@gmail.com')).toBeInTheDocument();
    expect(screen.getByText('04•• ••• 678')).toBeInTheDocument();
  });

  it('shows a server error (e.g. too many tries) and stays on the form', async () => {
    requestMemberCodes.mockResolvedValue({ status: 'error', message: 'Please wait a minute before asking for new codes.' });
    await openTyped();
    type('Your email address', 'jane@gmail.com');
    type('Your mobile number', '0412345678');
    click('Send my codes');
    expect(await screen.findByText(/wait a minute/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Welcome to the AFJ Member Portal' })).toBeInTheDocument();
  });
});

describe('entering the two codes', () => {
  it('restricts each box to 6 digits and cleans a pasted code', async () => {
    await reachCodes();
    type('Code from the email', '12ab34567890');
    type('Code from the text message', 'Code: 654 321');
    expect(screen.getByLabelText('Code from the email')).toHaveValue('123456');
    expect(screen.getByLabelText('Code from the text message')).toHaveValue('654321');
  });

  it('flags empty/short codes on Validate and never submits while an error remains', async () => {
    await reachCodes();
    click('Validate');
    expect(screen.getAllByRole('alert').map((a) => a.textContent)).toEqual([
      'Please type the code from the email.', 'Please type the code from the text message.',
    ]);
    type('Code from the email', '123');
    click('Validate');
    expect(screen.getByText(/email has 6 digits/)).toBeInTheDocument();
    expect(verifyMemberCodes).not.toHaveBeenCalled();

    type('Code from the email', '123456');
    expect(screen.queryByText(/email has 6 digits/)).not.toBeInTheDocument();
  });

  it('signs in and goes to the member area when both codes are accepted, forgetting the saved step', async () => {
    verifyMemberCodes.mockResolvedValue({ status: 'ok' });
    await reachCodes();
    expect(localStorage.getItem(MEMBER_PENDING_KEY)).not.toBeNull();
    type('Code from the email', '123456');
    type('Code from the text message', '654321');
    click('Validate');
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/member'));
    expect(verifyMemberCodes).toHaveBeenCalledWith({ verificationId: VID, emailCode: '123456', smsCode: '654321' });
    expect(localStorage.getItem(MEMBER_PENDING_KEY)).toBeNull();
  });

  it('keeps the typed codes and the saved step when they do not match', async () => {
    verifyMemberCodes.mockResolvedValue({ status: 'error', message: "Those codes didn't match. Please check them and try again.", code: 'invalid' });
    await reachCodes();
    type('Code from the email', '123456');
    type('Code from the text message', '654321');
    click('Validate');
    expect(await screen.findByText(/didn't match/)).toBeInTheDocument();
    expect(screen.getByLabelText('Code from the email')).toHaveValue('123456');
    expect(replace).not.toHaveBeenCalled();
    expect(localStorage.getItem(MEMBER_PENDING_KEY)).not.toBeNull();
  });

  it('offers new codes (and blocks Validate) once the codes have expired', async () => {
    verifyMemberCodes.mockResolvedValue({ status: 'error', message: 'Those codes have expired — please ask for new ones.', code: 'expired' });
    await reachCodes();
    type('Code from the email', '123456');
    type('Code from the text message', '654321');
    click('Validate');
    expect(await screen.findByText(/expired/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Validate' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Send me new codes' })).toBeEnabled();
    expect(localStorage.getItem(MEMBER_PENDING_KEY)).toBeNull();
  });

  it('makes the member wait before asking for new codes again', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    await reachCodes();
    expect(screen.getByRole('button', { name: /Send me new codes \(wait 60s\)/ })).toBeDisabled();
    await act(async () => { vi.advanceTimersByTime(61_000); });
    expect(screen.getByRole('button', { name: 'Send me new codes' })).toBeEnabled();
  });
});

describe('losing the page while reading the email and text (phone reload)', () => {
  it('puts the member back on the code boxes after a reload, using only the saved step', async () => {
    await reachCodes();
    cleanup();
    requestMemberCodes.mockReset();
    render(<MemberSignIn />);
    expect(await screen.findByRole('heading', { name: 'Enter your codes' })).toBeInTheDocument();
    expect(screen.getByText('j•••@gmail.com')).toBeInTheDocument();
    expect(screen.getByLabelText('Code from the email')).toHaveValue('');
    expect(requestMemberCodes).not.toHaveBeenCalled();
    expect(localStorage.getItem(MEMBER_PENDING_KEY)).not.toMatch(/jane@|0412/);
  });

  it('does not restore a step saved for a different way in (typed vs link)', async () => {
    await reachCodes();
    cleanup();
    search = `i=${'a'.repeat(43)}`;
    fetchMemberInvite.mockResolvedValue({ status: 'ok', maskedEmail: 'j•••@gmail.com', maskedMobile: '04•• ••• 678', eligible: true });
    render(<MemberSignIn />);
    expect(await screen.findByRole('heading', { name: "Let's make sure it's you" })).toBeInTheDocument();
    expect(localStorage.getItem(MEMBER_PENDING_KEY)).toBeNull();
  });
});

describe('a customised link', () => {
  const TOKEN = 'a'.repeat(43);
  beforeEach(() => { search = `i=${TOKEN}`; });

  it('shows the masked details in the agreed wording and sends codes on one tap', async () => {
    fetchMemberInvite.mockResolvedValue({ status: 'ok', maskedEmail: 'j•••@gmail.com', maskedMobile: '04•• ••• 678', eligible: true });
    requestMemberCodes.mockResolvedValue(SENT);
    render(<MemberSignIn />);
    await screen.findByRole('heading', { name: "Let's make sure it's you" });
    expect(document.body.textContent).toMatch(/owner of the email address j•••@gmail\.com and the mobile number 04•• ••• 678/);
    expect(requestMemberCodes).not.toHaveBeenCalled(); // never auto-sends
    click('Send my codes');
    await screen.findByRole('heading', { name: 'Enter your codes' }, WAIT);
    expect(requestMemberCodes).toHaveBeenCalledWith({ invite: TOKEN });
  });

  it('shows the help screen when the person cannot sign in by themselves', async () => {
    fetchMemberInvite.mockResolvedValue({ status: 'ok', maskedEmail: 'j•••@gmail.com', maskedMobile: null, eligible: false });
    render(<MemberSignIn />);
    expect(await screen.findByRole('heading', { name: /help you sign in/ })).toBeInTheDocument();
    expect(requestMemberCodes).not.toHaveBeenCalled();
  });

  it('falls back to typing details, with a plain notice, when the link is not valid', async () => {
    fetchMemberInvite.mockResolvedValue({ status: 'invalid' });
    render(<MemberSignIn />);
    expect(await screen.findByText(/link isn't valid any more/)).toBeInTheDocument();
    expect(screen.getByLabelText('Your email address')).toBeInTheDocument();
  });
});

describe('already signed in', () => {
  it('goes straight to the member area', async () => {
    fetchMemberMe.mockResolvedValue({ status: 'ok', firstName: 'Jane' });
    render(<MemberSignIn />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/member'));
    expect(fetchMemberInvite).not.toHaveBeenCalled();
  });
});
