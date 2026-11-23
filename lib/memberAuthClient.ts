/**
 * Browser-side calls to /api/member/* for the sign-in screens and member shell.
 * Never throws: a network failure or an unexpected reply becomes a plain-words
 * `error` result the screen can show. Server messages are already written for
 * members, so they are passed through.
 */
export const MEMBER_NETWORK_ERROR = "We couldn't reach the server. Please check your internet connection and try again.";
const GENERIC_ERROR = 'Something went wrong. Please try again in a moment.';

type FetchLike = typeof fetch;

async function call(path: string, init: RequestInit | undefined, fetchImpl: FetchLike): Promise<{ status: number; body: Record<string, unknown> } | null> {
  try {
    const res = await fetchImpl(path, init);
    const body: unknown = await res.json().catch(() => null);
    return { status: res.status, body: (body && typeof body === 'object' ? body : {}) as Record<string, unknown> };
  } catch {
    return null;
  }
}
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const jsonPost = (payload: unknown): RequestInit => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });

export type InviteResult =
  | { status: 'ok'; maskedEmail: string | null; maskedMobile: string | null; eligible: boolean }
  | { status: 'invalid' }
  | { status: 'error'; message: string };

export async function fetchMemberInvite(token: string, fetchImpl: FetchLike = fetch): Promise<InviteResult> {
  const r = await call(`/api/member/invite?i=${encodeURIComponent(token)}`, undefined, fetchImpl);
  if (!r) return { status: 'error', message: MEMBER_NETWORK_ERROR };
  if (r.status === 404) return { status: 'invalid' };
  if (r.status !== 200) return { status: 'error', message: str(r.body.error) || GENERIC_ERROR };
  return {
    status: 'ok',
    maskedEmail: typeof r.body.maskedEmail === 'string' ? r.body.maskedEmail : null,
    maskedMobile: typeof r.body.maskedMobile === 'string' ? r.body.maskedMobile : null,
    eligible: r.body.eligible === true,
  };
}

/** The request body sent to /api/member/request-codes (distinct from the server's parsed shape in lib/memberSignInInput.ts). */
export type RequestCodesBody = { invite: string } | { email: string; mobile: string };
export type RequestCodesResult =
  | { status: 'sent'; verificationId: string; maskedEmail: string; maskedMobile: string }
  | { status: 'error'; message: string };

export async function requestMemberCodes(input: RequestCodesBody, fetchImpl: FetchLike = fetch): Promise<RequestCodesResult> {
  const r = await call('/api/member/request-codes', jsonPost(input), fetchImpl);
  if (!r) return { status: 'error', message: MEMBER_NETWORK_ERROR };
  if (r.status === 200 && r.body.success === true && typeof r.body.verificationId === 'string') {
    return { status: 'sent', verificationId: r.body.verificationId, maskedEmail: str(r.body.maskedEmail), maskedMobile: str(r.body.maskedMobile) };
  }
  return { status: 'error', message: str(r.body.error) || GENERIC_ERROR };
}

export type VerifyCode = 'invalid' | 'expired' | 'locked';
export type VerifyResult = { status: 'ok' } | { status: 'error'; message: string; code?: VerifyCode };

export async function verifyMemberCodes(
  input: { verificationId: string; emailCode: string; smsCode: string },
  fetchImpl: FetchLike = fetch,
): Promise<VerifyResult> {
  const r = await call('/api/member/verify', jsonPost(input), fetchImpl);
  if (!r) return { status: 'error', message: MEMBER_NETWORK_ERROR };
  if (r.status === 200 && r.body.success === true) return { status: 'ok' };
  const code = r.body.code === 'invalid' || r.body.code === 'expired' || r.body.code === 'locked' ? r.body.code : undefined;
  return { status: 'error', message: str(r.body.error) || GENERIC_ERROR, code };
}

export type MeResult = { status: 'ok'; firstName: string | null } | { status: 'signed_out' } | { status: 'error'; message: string };

export async function fetchMemberMe(fetchImpl: FetchLike = fetch): Promise<MeResult> {
  const r = await call('/api/member/me', undefined, fetchImpl);
  if (!r) return { status: 'error', message: MEMBER_NETWORK_ERROR };
  if (r.status === 401) return { status: 'signed_out' };
  if (r.status !== 200) return { status: 'error', message: GENERIC_ERROR };
  return { status: 'ok', firstName: typeof r.body.firstName === 'string' && r.body.firstName ? r.body.firstName : null };
}

export async function signOutMember(allDevices: boolean, fetchImpl: FetchLike = fetch): Promise<{ ok: boolean }> {
  const r = await call('/api/member/sign-out', jsonPost({ allDevices }), fetchImpl);
  // 401 means there was no session to end — already signed out.
  return { ok: !!r && (r.status === 200 || r.status === 401) };
}
