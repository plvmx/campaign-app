'use client';

/**
 * The member portal sign-in (docs/member-portal/SIGN_IN_DESIGN.md §3). A member
 * proves they own both the email address and the mobile number we hold: we
 * send a code to each (only ever to the details on file), they type both in
 * and tap Validate. Nothing here uses jargon (no "2FA", "MFA", "authenticator").
 *
 * Entry: a customised link (`?i=<token>`, details shown masked) or typed email +
 * mobile. The "codes sent" step is remembered on the device (lib/memberPendingSignIn.ts)
 * because phones reload the page while a member goes to read their email/texts.
 */
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  bodyTextClass, cardClass, errorBannerClass, headingClass, inputClass, labelClass, primaryButtonClass, secondaryButtonClass,
} from '@/components/auth/CodeEntryScreen';
import { MemberBanner } from '@/components/member/MemberBanner';
import { MemberHelp } from '@/components/member/MemberHelp';
import {
  fetchMemberInvite, fetchMemberMe, requestMemberCodes, verifyMemberCodes,
} from '@/lib/memberAuthClient';
import {
  clearMemberPending, loadMemberPending, saveMemberPending, type PendingMemberSignIn,
} from '@/lib/memberPendingSignIn';
import {
  hasFormErrors, normalizeEmailInput, normalizeMemberCodeInput, normalizeMobileInput,
  validateCodeField, validateCodes, validateDetailsField, validateDetails,
  type CodeErrors, type DetailsErrors,
} from '@/lib/memberSignInForm';

const RESEND_COOLDOWN_SECONDS = 60;
const MEMBER_HOME = '/member';

type Phase =
  | { kind: 'loading' }
  | { kind: 'confirm'; maskedEmail: string; maskedMobile: string }
  | { kind: 'typed'; notice?: string }
  | { kind: 'codes'; verificationId: string; maskedEmail: string; maskedMobile: string; via: 'invite' | 'typed' }
  | { kind: 'help' };

const inputErrorClass = 'border-red-600 dark:border-red-400';
const fieldErrorClass = 'mt-2 text-lg font-medium text-red-700 dark:text-red-300';

export default function MemberSignIn() {
  const router = useRouter();
  const token = useSearchParams().get('i');
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [email, setEmail] = useState('');
  const [mobile, setMobile] = useState('');
  const [detailsErrors, setDetailsErrors] = useState<DetailsErrors>({});

  const [emailCode, setEmailCode] = useState('');
  const [smsCode, setSmsCode] = useState('');
  const [codeErrors, setCodeErrors] = useState<CodeErrors>({});

  const [resendAt, setResendAt] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [needNewCodes, setNeedNewCodes] = useState(false);

  // Where to start: already signed in → home; a remembered "codes sent" step → the code boxes;
  // a customised link → its masked details; otherwise the typed form.
  useEffect(() => {
    let cancelled = false;
    const via: 'invite' | 'typed' = token ? 'invite' : 'typed';
    fetchMemberMe()
      .then(async (me): Promise<Phase | null> => {
        if (me.status === 'ok') { router.replace(MEMBER_HOME); return null; }
        const pending = loadMemberPending();
        if (pending && pending.via === via) {
          return { kind: 'codes', verificationId: pending.verificationId, maskedEmail: pending.maskedEmail, maskedMobile: pending.maskedMobile, via: pending.via };
        }
        if (pending) clearMemberPending();
        if (!token) return { kind: 'typed' };
        const invite = await fetchMemberInvite(token);
        if (invite.status === 'invalid') return { kind: 'typed', notice: "That link isn't valid any more. You can still sign in by typing your details below." };
        if (invite.status === 'error') return { kind: 'typed', notice: invite.message };
        if (!invite.eligible) return { kind: 'help' };
        return { kind: 'confirm', maskedEmail: invite.maskedEmail ?? '', maskedMobile: invite.maskedMobile ?? '' };
      })
      .then((next) => { if (next && !cancelled) setPhase(next); });
    return () => { cancelled = true; };
  }, [token, router]);

  // Tick once a second only while the "send new codes" button is cooling down.
  useEffect(() => {
    if (resendAt <= Date.now()) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [resendAt]);
  const secondsLeft = Math.max(0, Math.ceil((resendAt - now) / 1000));

  const goToCodes = useCallback((p: Omit<PendingMemberSignIn, 'savedAt'>) => {
    saveMemberPending(p);
    setPhase({ kind: 'codes', ...p });
    setEmailCode(''); setSmsCode(''); setCodeErrors({}); setFormError(null); setNeedNewCodes(false);
    const at = Date.now() + RESEND_COOLDOWN_SECONDS * 1000;
    setResendAt(at); setNow(Date.now());
  }, []);

  const sendCodes = useCallback(async (via: 'invite' | 'typed') => {
    setFormError(null);
    if (via === 'typed') {
      const errors = validateDetails({ email, mobile });
      setDetailsErrors(errors);
      if (hasFormErrors(errors)) return;
    }
    setBusy(true);
    const result = await requestMemberCodes(via === 'invite' && token ? { invite: token } : { email: email.trim(), mobile: mobile.trim() });
    setBusy(false);
    if (result.status === 'error') { setFormError(result.message); return; }
    goToCodes({ verificationId: result.verificationId, maskedEmail: result.maskedEmail, maskedMobile: result.maskedMobile, via });
  }, [email, mobile, token, goToCodes]);

  const validate = useCallback(async (verificationId: string) => {
    setFormError(null);
    const errors = validateCodes({ emailCode, smsCode });
    setCodeErrors(errors);
    if (hasFormErrors(errors)) return;
    setBusy(true);
    const result = await verifyMemberCodes({ verificationId, emailCode, smsCode });
    if (result.status === 'ok') {
      clearMemberPending();
      router.replace(MEMBER_HOME);
      return;
    }
    setBusy(false);
    setFormError(result.message);
    if (result.code === 'expired' || result.code === 'locked') { clearMemberPending(); setNeedNewCodes(true); setEmailCode(''); setSmsCode(''); }
  }, [emailCode, smsCode, router]);

  const handleDetailsChange = (field: 'email' | 'mobile', raw: string) => {
    const value = field === 'email' ? normalizeEmailInput(raw) : normalizeMobileInput(raw);
    if (field === 'email') setEmail(value); else setMobile(value);
    // Clear a field's message as soon as it is fixed.
    setDetailsErrors((prev) => (prev[field] && !validateDetailsField(field, value) ? { ...prev, [field]: undefined } : prev));
  };
  const handleCodeChange = (field: 'emailCode' | 'smsCode', raw: string) => {
    const value = normalizeMemberCodeInput(raw);
    if (field === 'emailCode') setEmailCode(value); else setSmsCode(value);
    setCodeErrors((prev) => (prev[field] && !validateCodeField(field, value) ? { ...prev, [field]: undefined } : prev));
  };

  const startOver = () => {
    clearMemberPending();
    setFormError(null); setDetailsErrors({}); setNeedNewCodes(false);
    setPhase({ kind: 'typed' });
  };

  let content;
  if (phase.kind === 'loading') {
    content = <p className={bodyTextClass} role="status">One moment…</p>;
  } else if (phase.kind === 'help') {
    content = (
      <>
        <MemberHelp />
        <button type="button" onClick={startOver} className={secondaryButtonClass}>I&apos;ll type my details in instead</button>
      </>
    );
  } else if (phase.kind === 'confirm') {
    content = (
      <>
        <h1 className={headingClass}>Let&apos;s make sure it&apos;s you</h1>
        <p className={bodyTextClass}>
          To <strong>sign you in</strong> and keep your information safe, we first need to check that you are the owner of the email
          address <strong>{phase.maskedEmail}</strong> and the mobile number <strong>{phase.maskedMobile}</strong>.
        </p>
        <p className={bodyTextClass}>Tap the button below and we&apos;ll send you an email and a text message. Each one has a code in it.</p>
        {formError && <p role="alert" className={errorBannerClass}>{formError}</p>}
        <button type="button" onClick={() => void sendCodes('invite')} disabled={busy} className={primaryButtonClass}>
          {busy ? 'Sending…' : 'Send my codes'}
        </button>
        <button type="button" onClick={() => setPhase({ kind: 'help' })} disabled={busy} className={secondaryButtonClass}>
          These aren&apos;t my details, or I need help
        </button>
      </>
    );
  } else if (phase.kind === 'typed') {
    content = (
      <form noValidate onSubmit={(e: FormEvent) => { e.preventDefault(); void sendCodes('typed'); }} className="space-y-6">
        <h1 className={headingClass}>Welcome to the AFJ Member Portal</h1>
        {phase.notice && <p role="alert" className={errorBannerClass}>{phase.notice}</p>}
        <p className={bodyTextClass}>
          To <strong>sign you in</strong> and keep your information safe, we first need to check that you are the owner of your email address
          and mobile number. Please type them in the way you gave them to us when you registered.
        </p>
        <div>
          <label htmlFor="member-email" className={labelClass}>Your email address</label>
          <input
            id="member-email" type="email" inputMode="email" autoComplete="email" autoCapitalize="none" spellCheck={false}
            value={email} onChange={(e) => handleDetailsChange('email', e.target.value)}
            aria-invalid={detailsErrors.email ? true : undefined} aria-describedby={detailsErrors.email ? 'member-email-error' : undefined}
            className={`${inputClass} ${detailsErrors.email ? inputErrorClass : ''}`}
          />
          {detailsErrors.email && <p id="member-email-error" role="alert" className={fieldErrorClass}>{detailsErrors.email}</p>}
        </div>
        <div>
          <label htmlFor="member-mobile" className={labelClass}>Your mobile number</label>
          <input
            id="member-mobile" type="tel" inputMode="tel" autoComplete="tel"
            value={mobile} onChange={(e) => handleDetailsChange('mobile', e.target.value)}
            aria-invalid={detailsErrors.mobile ? true : undefined} aria-describedby={detailsErrors.mobile ? 'member-mobile-error' : undefined}
            className={`${inputClass} ${detailsErrors.mobile ? inputErrorClass : ''}`}
          />
          {detailsErrors.mobile && <p id="member-mobile-error" role="alert" className={fieldErrorClass}>{detailsErrors.mobile}</p>}
        </div>
        {formError && <p role="alert" className={errorBannerClass}>{formError}</p>}
        <button type="submit" disabled={busy} className={primaryButtonClass}>{busy ? 'Sending…' : 'Send my codes'}</button>
        <button type="button" onClick={() => setPhase({ kind: 'help' })} disabled={busy} className={secondaryButtonClass}>I need help signing in</button>
      </form>
    );
  } else {
    const { verificationId, maskedEmail, maskedMobile, via } = phase;
    const canResend = !busy && secondsLeft === 0;
    content = (
      <form noValidate onSubmit={(e: FormEvent) => { e.preventDefault(); if (!needNewCodes) void validate(verificationId); }} className="space-y-6">
        <h1 className={headingClass}>Enter your codes</h1>
        <p className={bodyTextClass}>
          We&apos;ve sent an email to <strong>{maskedEmail}</strong> and a text message to <strong>{maskedMobile}</strong>.
          Please find those messages and type the code from each into the boxes below. When you have done that, tap Validate.
          The codes work for 10 minutes.
        </p>
        <p className={bodyTextClass}>
          Nothing arrived? Check your junk or spam folder, and that these are the email address and mobile number you registered with.
        </p>
        <div>
          <label htmlFor="member-email-code" className={labelClass}>Code from the email</label>
          <input
            id="member-email-code" inputMode="numeric" pattern="[0-9]*" autoComplete="off"
            value={emailCode} onChange={(e) => handleCodeChange('emailCode', e.target.value)}
            aria-invalid={codeErrors.emailCode ? true : undefined} aria-describedby={codeErrors.emailCode ? 'member-email-code-error' : undefined}
            className={`${inputClass} ${codeErrors.emailCode ? inputErrorClass : ''}`}
          />
          {codeErrors.emailCode && <p id="member-email-code-error" role="alert" className={fieldErrorClass}>{codeErrors.emailCode}</p>}
        </div>
        <div>
          <label htmlFor="member-sms-code" className={labelClass}>Code from the text message</label>
          <input
            id="member-sms-code" inputMode="numeric" pattern="[0-9]*" autoComplete="one-time-code"
            value={smsCode} onChange={(e) => handleCodeChange('smsCode', e.target.value)}
            aria-invalid={codeErrors.smsCode ? true : undefined} aria-describedby={codeErrors.smsCode ? 'member-sms-code-error' : undefined}
            className={`${inputClass} ${codeErrors.smsCode ? inputErrorClass : ''}`}
          />
          {codeErrors.smsCode && <p id="member-sms-code-error" role="alert" className={fieldErrorClass}>{codeErrors.smsCode}</p>}
        </div>
        {formError && <p role="alert" className={errorBannerClass}>{formError}</p>}
        <button type="submit" disabled={busy || needNewCodes} className={primaryButtonClass}>{busy ? 'Checking…' : 'Validate'}</button>
        <button
          type="button"
          onClick={() => (via === 'typed' && !email ? startOver() : void sendCodes(via))}
          disabled={!canResend && !needNewCodes}
          className={secondaryButtonClass}
        >
          {needNewCodes || canResend ? 'Send me new codes' : `Send me new codes (wait ${secondsLeft}s)`}
        </button>
        <button type="button" onClick={() => setPhase({ kind: 'help' })} disabled={busy} className={secondaryButtonClass}>
          I didn&apos;t get a message, or I need help
        </button>
      </form>
    );
  }

  return (
    <main data-ti="components/member/MemberSignIn.tsx" className="flex min-h-screen items-center justify-center bg-gray-50 p-4 dark:bg-gray-950">
      <div className={`${cardClass} space-y-6`}>
        <MemberBanner />
        {content}
      </div>
    </main>
  );
}
