import type { Metadata } from 'next';
import { PrintButton } from './PrintButton';
import { toSupportNumber } from '@/lib/supportContact';
import { AUTHENTICATOR_STORE_LINKS } from '@/lib/authenticatorApps';

export const metadata: Metadata = {
  title: 'Secure sign-in guide',
  description: 'Step-by-step help for confirming your email and setting up two-factor sign-in.',
  robots: { index: false, follow: false },
};

// Public, no login: someone stuck on the setup screens can open this from a
// "Stuck?" link, or print it. Words match the on-screen wording exactly
// (CONFIRM NOW, "Add to my authenticator app", "Time based", ...).


function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8 break-inside-avoid">
      <h2 className="text-2xl font-bold text-gray-900">
        <span className="mr-2 inline-flex h-9 w-9 items-center justify-center rounded-full bg-blue-700 text-lg text-white">{n}</span>
        {title}
      </h2>
      <div className="mt-3 space-y-3 text-lg leading-relaxed text-gray-800">{children}</div>
    </section>
  );
}

export default function TwoFactorGuidePage() {
  const supportNumber = toSupportNumber(process.env.NEXT_PUBLIC_SUPPORT_MOBILE);

  return (
    <main className="mx-auto max-w-2xl bg-white px-5 py-8 text-gray-900">
      <h1 className="text-3xl font-bold">Your secure sign-in — step by step</h1>
      <p className="mt-3 text-lg leading-relaxed text-gray-800">
        This takes about 10 minutes and you only do it once. You will need <strong>your phone</strong> and{' '}
        <strong>your email</strong>. Afterwards you will sign in with your email address and a 6-digit number from an app on your
        phone, instead of your mobile number.
      </p>
      <div className="mt-4"><PrintButton /></div>

      <Step n={1} title="Confirm your email">
        <p>When the app asks for your email address, type it in and press <strong>Continue</strong>.</p>
        <p>
          Open the email we send you. Tap the <strong>CONFIRM NOW</strong> link. A page opens that says{' '}
          <strong>One last step</strong> — tap the blue button.
        </p>
        <p>Can&apos;t find the email? Look in your <strong>Junk</strong> or <strong>Spam</strong> folder.</p>
      </Step>

      <Step n={2} title="Get a free authenticator app">
        <p>This is a small free app that shows a new 6-digit number every 30 seconds. Install one on your phone (you only need one):</p>
        <ul className="list-disc space-y-2 pl-6">
          {AUTHENTICATOR_STORE_LINKS.map((l) => (
            <li key={l.href}>
              <a href={l.href} target="_blank" rel="noopener noreferrer" className="font-semibold text-blue-700 underline">{l.label}</a>
            </li>
          ))}
        </ul>
        <p>If you already have one on your phone, you can use it.</p>
      </Step>

      <Step n={3} title="Add AFJ to the app">
        <p>
          On the app&apos;s setup screen, tap <strong>Add to my authenticator app</strong>. Your authenticator app should open and add
          AFJ by itself.
        </p>
        <p>If nothing happens, do this instead:</p>
        <ol className="list-decimal space-y-2 pl-6">
          <li>On the setup screen, tap <strong>Copy key</strong>.</li>
          <li>Open your authenticator app and choose <strong>Add</strong> (the + button), then <strong>Enter a setup key</strong>.</li>
          <li>Account name: type <strong>AFJ</strong>. Key: paste what you copied.</li>
          <li>If it asks for the type of key, choose <strong>Time based</strong>.</li>
        </ol>
        <p><strong>Already have an old AFJ entry in your app from an earlier try?</strong> Delete it first. Only the newest one works.</p>
      </Step>

      <Step n={4} title="Type the 6-digit number">
        <p>
          Go back to the AFJ setup screen. Type the <strong>6-digit number from your authenticator app</strong> and press{' '}
          <strong>Verify and continue</strong>. Type it before it changes.
        </p>
        <div className="rounded-md border-2 border-gray-800 bg-yellow-50 p-4">
          <p className="font-bold">There are two different numbers — don&apos;t mix them up:</p>
          <ul className="mt-2 list-disc space-y-1 pl-6">
            <li>The <strong>long number in the email</strong> is only used if the email link doesn&apos;t work.</li>
            <li>The <strong>6-digit number in your app</strong> is the one this step asks for.</li>
          </ul>
        </div>
      </Step>

      <Step n={5} title="Signing in from now on">
        <p>
          On the sign-in page, choose <strong>Sign in with email</strong>. Type your email, open the email we send, tap{' '}
          <strong>CONFIRM NOW</strong> then the blue button, and type the 6-digit number from your app.
        </p>
        <p>Once you&apos;re in you stay signed in for about a month — <strong>don&apos;t press Sign Out</strong> unless you need to.</p>
      </Step>

      <section className="mt-10 break-inside-avoid rounded-md border-2 border-gray-800 bg-gray-50 p-5">
        <h2 className="text-2xl font-bold">If the 6-digit number is rejected</h2>
        <ul className="mt-3 list-disc space-y-2 pl-6 text-lg leading-relaxed">
          <li>Check you are reading the <strong>newest</strong> AFJ entry in your app. Delete any older AFJ entries.</li>
          <li>Check your phone&apos;s date and time are set to <strong>automatic</strong> (Settings → Date &amp; Time).</li>
          <li>Type the number straight away — it changes every 30 seconds.</li>
          <li>Stay on the setup screen while you add the key. If the page reloads, it will show the same key again.</li>
        </ul>
        <p className="mt-4 text-lg">
          Still stuck? {supportNumber ? <>Text or call <strong>{supportNumber}</strong>.</> : <>Contact the person who asked you to set this up.</>}
        </p>
      </section>
    </main>
  );
}
