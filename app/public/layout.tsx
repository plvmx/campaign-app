import { Suspense, type ReactNode } from 'react';
import BackToAppBar from '@/components/BackToAppBar';

/**
 * Every no-login /public/* page is read by members of the public, many of them
 * older — so the whole section gets the larger text scale (see `.large-text` in
 * app/globals.css).
 *
 * `BackToAppBar` reads the query string, so it sits in its own Suspense
 * boundary — otherwise it would opt every statically-rendered public page
 * out of prerendering.
 */
export default function PublicLayout({ children }: { children: ReactNode }) {
  return (
    <div className="large-text">
      <Suspense fallback={null}>
        <BackToAppBar />
      </Suspense>
      {children}
    </div>
  );
}
