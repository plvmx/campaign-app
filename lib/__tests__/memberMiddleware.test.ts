import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';
import { middleware } from '../../middleware';

const req = (path: string, cookie?: string) => new NextRequest(`http://localhost${path}`, { headers: cookie ? { cookie } : {} });
const redirectTarget = (res: Response) => res.headers.get('location');

describe('member portal route guard', () => {
  it('leaves the sign-in screen open to everyone', () => {
    for (const p of ['/member/sign-in', '/member/sign-in/']) expect(redirectTarget(middleware(req(p)))).toBeNull();
  });
  it('sends a visitor with no member session to the member sign-in (not the leader login)', () => {
    for (const p of ['/member', '/member/anything']) {
      expect(redirectTarget(middleware(req(p)))).toBe('http://localhost/member/sign-in');
    }
  });
  it('lets a visitor with a member_session cookie through', () => {
    expect(redirectTarget(middleware(req('/member', 'member_session=abc')))).toBeNull();
  });
  it('is not satisfied by the leader cookie', () => {
    expect(redirectTarget(middleware(req('/member', 'app_session=1')))).toBe('http://localhost/member/sign-in');
  });
  it('does not capture look-alike paths', () => {
    expect(redirectTarget(middleware(req('/membership')))).toBeNull();
  });
});
