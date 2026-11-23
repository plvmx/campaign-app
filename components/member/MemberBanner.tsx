/**
 * The AFJ banner at the top of the member portal screens: the reversed "Australia For Jesus —
 * Bringing Others to Christ" logo (white lettering) on the brand's dark panel. A dark panel is
 * used rather than the black-lettered logo on white so one image reads correctly in light AND
 * dark mode with no theme switching. The SVGs in /public were converted from the supplied EPS
 * artwork (lettering is outlined, so no fonts are needed).
 *
 * Clear space (brand guideline): 3X on every side, which is 10.2% of the logo's width. The
 * panel's padding is a percentage of the panel's own width, and 9% on each side leaves the logo
 * 82% of the width, so the clear space is 9 / 82 = 11% of the logo width — just over the minimum
 * at every screen size.
 */
import Image from 'next/image';

export const MEMBER_BANNER_ALT = 'Australia For Jesus — Bringing Others to Christ';

export function MemberBanner() {
  return (
    <div data-ti="components/member/MemberBanner.tsx" className="mx-auto w-full max-w-sm rounded-md bg-[#231f20]" style={{ padding: '9%' }}>
      {/* unoptimized: next/image's optimiser is for bitmaps; an SVG is served as is */}
      <Image src="/afj-logo-reversed.svg" alt={MEMBER_BANNER_ALT} width={351} height={153} priority unoptimized className="block h-auto w-full" />
    </div>
  );
}
