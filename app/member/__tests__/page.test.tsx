import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

const replace = vi.fn();
const router = { replace }; // stable, like Next's own router object
vi.mock('next/navigation', () => ({ useRouter: () => router }));
const fetchMemberMe = vi.fn();
const signOutMember = vi.fn();
vi.mock('@/lib/memberAuthClient', () => ({
  fetchMemberMe: (...a: unknown[]) => fetchMemberMe(...a),
  signOutMember: (...a: unknown[]) => signOutMember(...a),
}));

import MemberHomePage from '../page';

beforeEach(() => { for (const m of [replace, fetchMemberMe, signOutMember]) m.mockReset(); });
afterEach(cleanup);

describe('/member', () => {
  it('welcomes a signed-in member by first name', async () => {
    fetchMemberMe.mockResolvedValue({ status: 'ok', firstName: 'Jane' });
    render(<MemberHomePage />);
    expect(await screen.findByRole('heading', { name: 'Welcome, Jane' })).toBeInTheDocument();
  });

  it('sends a signed-out visitor to the member sign-in', async () => {
    fetchMemberMe.mockResolvedValue({ status: 'signed_out' });
    render(<MemberHomePage />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/member/sign-in'));
  });

  it.each([
    ['Sign out', false],
    ['Sign out on all my devices', true],
  ])('"%s" signs out (all devices: %s) and returns to sign-in', async (label, allDevices) => {
    fetchMemberMe.mockResolvedValue({ status: 'ok', firstName: null });
    signOutMember.mockResolvedValue({ ok: true });
    render(<MemberHomePage />);
    fireEvent.click(await screen.findByRole('button', { name: label }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/member/sign-in'));
    expect(signOutMember).toHaveBeenCalledWith(allDevices);
  });

  it('says so, and stays put, if sign-out fails', async () => {
    fetchMemberMe.mockResolvedValue({ status: 'ok', firstName: 'Jane' });
    signOutMember.mockResolvedValue({ ok: false });
    render(<MemberHomePage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Sign out' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/couldn't sign you out/);
    expect(replace).not.toHaveBeenCalled();
  });
});
