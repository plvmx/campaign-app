/**
 * Wording of the two sign-in messages (docs/member-portal/SIGN_IN_DESIGN.md §3, §8).
 * Deliberately plain: no mention of verification systems, and each message
 * says the code is for signing in, expires, and must not be shared.
 */
import type { OutgoingEmail } from './resendClient';

export const MEMBER_CODE_EXPIRY_MINUTES = 10;

export function buildMemberSmsBody(code: string): string {
  return `Your AFJ sign-in code is ${code}. It expires in ${MEMBER_CODE_EXPIRY_MINUTES} minutes. Don't share it with anyone.`;
}

export function buildMemberCodeEmail(to: string, firstName: string | null, code: string): OutgoingEmail {
  const greeting = firstName && firstName.trim() ? `Hi ${firstName.trim()},` : 'Hello,';
  const text = [
    greeting,
    '',
    `Your AFJ sign-in code is: ${code}`,
    '',
    `Type it into the "Code from the email" box. It expires in ${MEMBER_CODE_EXPIRY_MINUTES} minutes.`,
    "If you didn't ask to sign in, you can ignore this email — nobody can sign in without it.",
  ].join('\n');
  const html = `<p>${escapeHtml(greeting)}</p>
<p style="font-size:18px">Your AFJ sign-in code is:</p>
<p style="font-size:32px;font-weight:bold;letter-spacing:4px">${code}</p>
<p style="font-size:16px">Type it into the <strong>Code from the email</strong> box. It expires in ${MEMBER_CODE_EXPIRY_MINUTES} minutes.</p>
<p style="font-size:14px;color:#555">If you didn't ask to sign in, you can ignore this email — nobody can sign in without it.</p>`;
  return { to: [to], subject: 'Your AFJ sign-in code', html, text };
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
