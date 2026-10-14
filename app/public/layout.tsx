import type { ReactNode } from 'react';

/**
 * Every no-login /public/* page is read by members of the public, many of them
 * older — so the whole section gets the larger text scale (see `.large-text` in
 * app/globals.css).
 */
export default function PublicLayout({ children }: { children: ReactNode }) {
  return <div className="large-text">{children}</div>;
}
