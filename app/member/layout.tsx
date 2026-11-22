import type { Metadata } from 'next';
import type { ReactNode } from 'react';

// The member portal is personal: keep it out of search results. The screens use
// the explicit large sizes from components/auth/CodeEntryScreen.tsx, so this layout
// deliberately does NOT add the `large-text` scale (they would scale twice).
export const metadata: Metadata = {
  title: 'AFJ Member Area',
  robots: { index: false, follow: false },
};

export default function MemberLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
