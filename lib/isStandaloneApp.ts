type StandaloneEnv = {
  matchMedia?: (query: string) => { matches: boolean };
  navigator?: object; // iOS adds a non-standard `standalone` flag, read below
};

/**
 * True when the app is running from the phone's home screen (an installed
 * PWA) rather than in a browser tab. On iPhone an installed app has its own
 * storage, separate from Safari, so an emailed sign-in link — which opens in
 * Safari — signs the leader in *there* and the installed app never receives
 * it (Geoff, an SA admin on iPhone, kept seeing the sign-in form each time he
 * reopened the icon, 2026-11-04). A typed code is verified inside whichever
 * app the leader is looking at, so those screens lead with it.
 */
export function isStandaloneApp(env: StandaloneEnv | undefined =
  typeof window === 'undefined' ? undefined : window): boolean {
  if (!env) return false;
  if ((env.navigator as { standalone?: boolean } | undefined)?.standalone === true) return true; // iOS Safari's own flag
  return env.matchMedia?.('(display-mode: standalone)').matches === true;
}
