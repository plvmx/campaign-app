import { getMemberHelpEmail } from '@/lib/memberHelp';
import { bodyTextClass, headingClass } from '@/components/auth/CodeEntryScreen';

/**
 * Shown when a member can't sign in by themselves — no mobile on file, a changed
 * phone or email, or codes that never arrive (docs/member-portal/SIGN_IN_DESIGN.md §9).
 */
export function MemberHelp() {
  const email = getMemberHelpEmail();
  return (
    <div data-ti="components/member/MemberHelp.tsx" className="space-y-6">
      <h1 className={headingClass}>We&apos;ll help you sign in</h1>
      <p className={bodyTextClass}>
        Sometimes we can&apos;t send the codes — for example if we don&apos;t have your mobile number, or your phone number or email
        address has changed since you registered.
      </p>
      <p className={bodyTextClass}>
        Please contact us and tell us your name and the email address you registered with, and we will sort it out with you.
      </p>
      {email && (
        <p className={bodyTextClass}>
          <a href={`mailto:${email}`} className="font-semibold text-blue-700 underline dark:text-blue-300">Email {email}</a>
        </p>
      )}
    </div>
  );
}
