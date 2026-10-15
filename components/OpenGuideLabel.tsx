/**
 * The bold gold "OPEN" over "GUIDE" label — shared by the bottom-bar button
 * (MobileLayout) and the OPEN GUIDE buttons on the sign-in screens
 * (GuideScreen's OpenGuideButton), so they look the same everywhere.
 * Fixed 16px (`text-[1rem]`, not `text-base`) so the sign-in screens'
 * `large-text` wrapper doesn't enlarge it there.
 */
export default function OpenGuideLabel() {
  return (
    <span className="flex flex-col items-center text-center text-[1rem] font-extrabold leading-tight tracking-wide text-amber-500 dark:text-amber-400">
      <span>OPEN</span>
      <span>GUIDE</span>
    </span>
  );
}
