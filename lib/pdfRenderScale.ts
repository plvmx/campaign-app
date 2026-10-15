/**
 * Sizing for rendering a PDF page onto a canvas (components/PdfGuideViewer.tsx).
 * The page is shown at the container's width; the canvas backing store is
 * rendered at up to 2× that so text stays sharp on high-density phone screens
 * and when pinch-zoomed — capped at 2× because a 3× canvas per page adds up
 * quickly in phone memory for a long guide.
 */
export const MAX_RENDER_PIXEL_RATIO = 2;

export function computePdfRenderScale(
  containerWidth: number,
  pageWidth: number,
  devicePixelRatio: number,
): { cssScale: number; renderScale: number } {
  if (!(containerWidth > 0) || !(pageWidth > 0)) return { cssScale: 1, renderScale: 1 };
  const cssScale = containerWidth / pageWidth;
  const ratio = Math.min(Math.max(devicePixelRatio || 1, 1), MAX_RENDER_PIXEL_RATIO);
  return { cssScale, renderScale: cssScale * ratio };
}
