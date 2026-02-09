/**
 * Applies inline styles to a report element (or its clone) so that when
 * html2canvas captures it, the JPEG matches the preview. Call this:
 * 1) on the clone before passing it to html2canvas (so the node has inline styles),
 * 2) inside html2canvas's onclone (so the iframe clone has them if copy differs).
 */
export function applyReportCloneStyles(clonedElement: HTMLElement): void {
  clonedElement.querySelectorAll('th, td').forEach((node) => {
    const el = node as HTMLElement;
    el.style.setProperty('padding-top', '0.25rem', 'important');
    el.style.setProperty('padding-bottom', '0.25rem', 'important');
    el.style.setProperty('vertical-align', 'top', 'important');
    el.style.setProperty('line-height', '1.25', 'important');
    el.style.setProperty('box-sizing', 'border-box', 'important');
  });
  const indexDiv =
    clonedElement.querySelector('.mb-1') ??
    Array.from(clonedElement.querySelectorAll('div')).find((d) => d.textContent?.includes('INDEX'));
  if (indexDiv instanceof HTMLElement) {
    indexDiv.style.setProperty('margin-bottom', '0.25rem', 'important');
  }
  clonedElement.style.setProperty('padding-top', '0.5rem', 'important');
}
