/**
 * Where a member who can't sign in by themselves (no mobile on file, changed
 * phone or email, codes never arrive) is told to turn. NEXT_PUBLIC_MEMBER_HELP_EMAIL
 * (inlined at build time) is optional; without it the screen asks them to
 * contact AFJ in general words rather than showing a dead link.
 */
export function getMemberHelpEmail(raw: string | undefined | null = process.env.NEXT_PUBLIC_MEMBER_HELP_EMAIL): string | null {
  const v = (raw ?? '').trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? v : null;
}
