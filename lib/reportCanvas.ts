/**
 * Renders a single page of the campaign results report to a canvas with full
 * control over spacing and alignment. Used for JPEG export instead of html2canvas,
 * which has known issues with table cell padding and vertical-align.
 */

export interface ReportRowForCanvas {
  dateLocation: string;
  fpAndSp: string[];
  fpOnly: string[];
  pp: string[];
}

const WIDTH = 1200;
const SCALE = 2;
// Minimal spacing: small gaps above/between lines only
const PAD_TOP = 4; // minimal space above INDEX line
const PAD_SIDES = 32;
const INDEX_FONT = 'bold italic 18px Arial, sans-serif';
const HEADER_FONT = 'bold 18px Arial, sans-serif';
const CELL_FONT = '20px Arial, sans-serif';
const CELL_PAD_V = 2; // minimal padding above/below text in each cell
const CELL_PAD_H = 8;
const LINE_HEIGHT = 22; // 20px font + 2px gap = minimal space between lines
const BORDER = 2;
const INDEX_MARGIN_BOTTOM = 4; // minimal gap between INDEX and table

const TABLE_WIDTH = WIDTH - PAD_SIDES * 2;
const COL_WIDTHS = [
  Math.round(TABLE_WIDTH * 0.2),
  Math.round(TABLE_WIDTH * 0.27),
  Math.round(TABLE_WIDTH * 0.27),
  Math.round(TABLE_WIDTH * 0.26),
];
const HEADER_ROW_HEIGHT = CELL_PAD_V * 2 + 18; // minimal header row height

function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number
): string[] {
  if (!text.trim()) return [''];
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = '';
  for (const w of words) {
    const next = current ? current + ' ' + w : w;
    if (ctx.measureText(next).width <= maxWidth) {
      current = next;
    } else {
      if (current) lines.push(current);
      current = w;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function getCellContent(
  row: ReportRowForCanvas,
  field: keyof ReportRowForCanvas
): string {
  if (field === 'dateLocation') return row.dateLocation;
  const arr = row[field];
  return Array.isArray(arr) ? arr.join(', ') : '';
}

/**
 * Draw one page of the report (INDEX + header + given rows) and return the canvas.
 * All spacing and alignment are explicit (no CSS/table layout).
 */
export function drawReportPage(
  rows: ReportRowForCanvas[],
  opts?: { scale?: number }
): HTMLCanvasElement {
  const scale = opts?.scale ?? SCALE;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;

  // Use a temporary 1x canvas to measure text (same font = same metrics)
  canvas.width = WIDTH;
  canvas.height = 100;
  ctx.font = CELL_FONT;

  const fields: (keyof ReportRowForCanvas)[] = ['dateLocation', 'fpAndSp', 'fpOnly', 'pp'];
  const cellInnerWidths = COL_WIDTHS.map((cw) => cw - BORDER - CELL_PAD_H * 2);

  const rowHeights: number[] = [];
  for (const row of rows) {
    let maxLines = 1;
    for (let c = 0; c < fields.length; c++) {
      const lines = wrapText(ctx, getCellContent(row, fields[c]), cellInnerWidths[c]);
      maxLines = Math.max(maxLines, lines.length);
    }
    rowHeights.push(CELL_PAD_V * 2 + maxLines * LINE_HEIGHT);
  }

  const dataHeight = rowHeights.reduce((a, b) => a + b, 0);
  const totalHeight =
    PAD_TOP + 18 + INDEX_MARGIN_BOTTOM + HEADER_ROW_HEIGHT + BORDER + dataHeight + (rows.length - 1) * BORDER + PAD_TOP;

  canvas.width = WIDTH * scale;
  canvas.height = Math.ceil(totalHeight * scale);
  ctx.setTransform(scale, 0, 0, scale, 0, 0);

  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, WIDTH, totalHeight);
  ctx.fillStyle = '#000';
  ctx.strokeStyle = '#000';
  ctx.lineWidth = BORDER;

  let y = PAD_TOP;

  // INDEX line
  ctx.font = INDEX_FONT;
  ctx.textAlign = 'center';
  ctx.fillText(
    'INDEX:  SP - Salvation Prayer  FP – Full Presentation  PP - Partial Presentation',
    WIDTH / 2,
    y + 14
  );
  y += 18 + INDEX_MARGIN_BOTTOM;

  const tableX = PAD_SIDES;

  // Header row
  ctx.font = HEADER_FONT;
  ctx.textAlign = 'center';
  let x = tableX;
  for (let c = 0; c < COL_WIDTHS.length; c++) {
    const cw = COL_WIDTHS[c];
    ctx.strokeRect(x, y, cw, HEADER_ROW_HEIGHT);
    const label = c === 0 ? 'Date & Location' : c === 1 ? 'FP & SP' : c === 2 ? 'FP only' : 'PP';
    ctx.fillText(label, x + cw / 2, y + CELL_PAD_V + 14);
    x += cw + BORDER;
  }
  y += HEADER_ROW_HEIGHT + BORDER;

  // Data rows
  ctx.font = CELL_FONT;
  ctx.textAlign = 'left';
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    const rowH = rowHeights[r];
    x = tableX;
    for (let c = 0; c < fields.length; c++) {
      const cw = COL_WIDTHS[c];
      ctx.strokeRect(x, y, cw, rowH);
      const text = getCellContent(row, fields[c]);
      const lines = wrapText(ctx, text, cellInnerWidths[c]);
      let lineY = y + CELL_PAD_V + 16;
      for (const line of lines) {
        ctx.fillText(line, x + CELL_PAD_H + BORDER, lineY);
        lineY += LINE_HEIGHT;
      }
      x += cw + BORDER;
    }
    y += rowH + BORDER;
  }

  return canvas;
}

export function canvasToJpegBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Failed to create JPEG'))),
      'image/jpeg',
      0.95
    );
  });
}
