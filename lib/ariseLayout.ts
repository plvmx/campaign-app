/**
 * Layout constants and simulation logic for the Week 1 Campaigns canvas.
 * Consumed by ariseCanvas.ts (drawing) and ariseGenerator.ts (orchestration).
 */

// ---------------------------------------------------------------------------
// Canvas dimensions
// ---------------------------------------------------------------------------

const DPI    = 300;
export const WIDTH  = Math.floor(14 * DPI); // 4200 px  (14" landscape)
export const HEIGHT = Math.floor(10 * DPI); // 3000 px  (10" landscape)

// ---------------------------------------------------------------------------
// Font sizes
// ---------------------------------------------------------------------------

export const FONT_TITLE = 72;
export const FONT_KEY   = 54;
export const FONT_DATE  = 70;
export const FONT_CAMP  = 84;

// ---------------------------------------------------------------------------
// Column layout
// ---------------------------------------------------------------------------

export const PLACE_COLS  = 20;
export const TIME_COLS   = 9;
export const LEADER_COLS = 15;

export function apx(inches: number): number {
  return Math.floor(inches * DPI);
}

export const CONTENT_TOP    = apx(1.0);
export const BOTTOM_MARGIN  = apx(0.5);
export const CONTENT_BOTTOM = HEIGHT - BOTTOM_MARGIN;

export const DATE_PAD        = apx(0.08);
export const DATE_BLOCK_H    = FONT_DATE + 2 * DATE_PAD;
export const DATE_HDR_SPACE  = apx(0.05);
export const DATE_TOP_MARGIN = apx(0.1);
export const LINE_SPACING    = apx(0.3);
export const SEP_H           = FONT_KEY + apx(0.08);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AriseCampaign {
  id: string;
  date: string;
  state: string;
  place: string;
  site: string;
  time: string;
  leader: string;
  category: string | null;
}

// ---------------------------------------------------------------------------
// Layout simulation
// ---------------------------------------------------------------------------

/**
 * Simulates placing 8 days of campaigns into columns and returns how many
 * columns are required. Mirrors the drawing algorithm without canvas ops.
 */
export function simulateColumnCount(allCampaigns: AriseCampaign[][]): number {
  let colCount   = 1;
  let currentY   = CONTENT_TOP;
  let firstInCol = true;

  for (let dayIndex = 0; dayIndex < allCampaigns.length; dayIndex++) {
    if (dayIndex === 7) {
      const topM   = firstInCol ? 0 : DATE_TOP_MARGIN;
      const needed = topM + SEP_H;
      if (currentY + needed > CONTENT_BOTTOM) {
        colCount++;
        currentY   = CONTENT_TOP;
        firstInCol = true;
      }
      currentY  += (firstInCol ? 0 : DATE_TOP_MARGIN) + SEP_H;
      firstInCol = false;
    }

    const count = allCampaigns[dayIndex].length;
    if (count === 0) continue;

    let remaining = count;
    while (remaining > 0) {
      const topM      = firstInCol ? 0 : DATE_TOP_MARGIN;
      const minNeeded = topM + DATE_BLOCK_H + DATE_HDR_SPACE + LINE_SPACING;

      if (currentY + minNeeded > CONTENT_BOTTOM) {
        colCount++;
        currentY   = CONTENT_TOP;
        firstInCol = true;
        continue;
      }

      const lineY = currentY + (firstInCol ? 0 : DATE_TOP_MARGIN) + DATE_BLOCK_H + DATE_HDR_SPACE;
      const avail = CONTENT_BOTTOM - lineY;
      const nFit  = Math.max(0, Math.floor(avail / LINE_SPACING));

      if (nFit === 0) {
        colCount++;
        currentY   = CONTENT_TOP;
        firstInCol = true;
        continue;
      }

      currentY   = lineY + Math.min(remaining, nFit) * LINE_SPACING;
      firstInCol = false;
      remaining  = Math.max(0, remaining - nFit);
    }
  }

  return colCount;
}

/**
 * Returns the column width and left-edge X positions for `nCols` equal columns.
 */
export function computeColLayout(
  nCols: number,
  sideMargin: number,
): { colWidth: number; colXs: number[] } {
  const colWidth = Math.floor((WIDTH - 2 * sideMargin) / nCols);
  const colXs    = Array.from({ length: nCols }, (_, i) => sideMargin + i * colWidth);
  return { colWidth, colXs };
}
