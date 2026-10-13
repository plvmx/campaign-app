/** "Step 2 of 3 — Set up your authenticator app": tells a nervous reader how far along they are. */
export function SetupStep({ n, of = 3, label }: { n: number; of?: number; label: string }) {
  return (
    <p className="text-center text-sm font-semibold text-blue-800 dark:text-blue-300">
      Step {n} of {of}: {label}
    </p>
  );
}
