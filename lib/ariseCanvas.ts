/**
 * Canvas drawing helpers and renderer for the Week 1 Campaigns JPEG.
 * Depends on ariseLayout.ts for constants and types.
 */

import {
  WIDTH, HEIGHT, FONT_TITLE, FONT_KEY, FONT_DATE, FONT_CAMP,
  PLACE_COLS, TIME_COLS, LEADER_COLS,
  CONTENT_TOP, CONTENT_BOTTOM,
  DATE_PAD, DATE_BLOCK_H, DATE_HDR_SPACE, DATE_TOP_MARGIN,
  LINE_SPACING, SEP_H,
  apx, simulateColumnCount, computeColLayout,
  type AriseCampaign,
} from '@/lib/ariseLayout';
import { getSlideStateColor, formatSlideDateText, STATE_CODES } from '@/lib/slideLayout';
import { formatCampaignTimeDisplay } from '@/lib/campaignUtils';
import { combinePlaceAndSite } from '@/lib/placeSite';

// Fraction of an average character width used for the gap between fields and
// the side margins of a campaign line. Kept below 1 char so more of the
// column's width goes to the actual letters instead of whitespace.
const FIELD_GAP_CHARS = 0.4;
const MARGIN_CHARS    = 0.5;

// ---------------------------------------------------------------------------
// Draw helpers
// ---------------------------------------------------------------------------

export function drawBannerAndKey(ctx: CanvasRenderingContext2D): void {
  const bannerH = apx(0.5);
  ctx.fillStyle = 'rgb(255, 0, 0)';
  ctx.fillRect(0, 0, WIDTH, bannerH);
  ctx.fillStyle = 'white';
  ctx.font = `bold ${FONT_TITLE}px Arial`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('A.F.J UPCOMING CAMPAIGNS', WIDTH / 2, bannerH / 2);

  ctx.font = `bold ${FONT_KEY}px Arial`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  const keyLabel = 'Colour Key:    ';
  let totalW = ctx.measureText(keyLabel).width;
  STATE_CODES.forEach((s, i) => {
    totalW += ctx.measureText(s).width;
    if (i < STATE_CODES.length - 1) totalW += ctx.measureText('   ').width;
  });

  let xPos = (WIDTH - totalW) / 2;
  const yKey = apx(0.6) + apx(0.1);
  ctx.fillStyle = 'rgb(130, 0, 0)';
  ctx.fillText(keyLabel, xPos, yKey);
  xPos += ctx.measureText(keyLabel).width;
  STATE_CODES.forEach((s, i) => {
    ctx.fillStyle = getSlideStateColor(s);
    ctx.fillText(s, xPos, yKey);
    xPos += ctx.measureText(s).width;
    if (i < STATE_CODES.length - 1) {
      ctx.fillStyle = 'rgb(0, 0, 0)';
      ctx.fillText('   ', xPos, yKey);
      xPos += ctx.measureText('   ').width;
    }
  });
}

export function drawDateHeader(
  ctx: CanvasRenderingContext2D,
  date: Date,
  colX: number,
  y: number,
  colWidth: number,
): void {
  ctx.font = `italic ${FONT_DATE}px Arial`;
  const text = formatSlideDateText(date);
  const tw   = ctx.measureText(text).width;
  const bw   = Math.min(tw + 2 * DATE_PAD, colWidth);
  ctx.fillStyle = 'rgb(255, 255, 0)';
  ctx.fillRect(colX, y, bw, DATE_BLOCK_H);
  ctx.fillStyle = 'rgb(130, 0, 0)';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(text, colX + DATE_PAD, y + DATE_PAD);
}

export function drawCampaignLine(
  ctx: CanvasRenderingContext2D,
  campaign: AriseCampaign,
  colX: number,
  y: number,
  colWidth: number,
): void {
  let place = combinePlaceAndSite(campaign.place, campaign.site);
  const cat = campaign.category ?? 'TWOL';
  if (cat !== 'TWOL') place = `${place} ${cat}`;
  if (place.length > PLACE_COLS) place = place.substring(0, PLACE_COLS);

  const time   = formatCampaignTimeDisplay(campaign.time);
  const leader = campaign.leader.length > LEADER_COLS
    ? campaign.leader.substring(0, LEADER_COLS)
    : campaign.leader;

  ctx.font = `${FONT_CAMP}px Arial`;

  // Arial is proportional, so columns can't rely on character counts like a
  // monospace font would. Each field gets its own fixed-width slot so
  // place/time/leader still line up vertically across rows. Sizing the slots
  // off 'M' (one of the widest glyphs) over-compresses ordinary text, so use
  // the average glyph width across a representative character set instead.
  const AVG_SAMPLE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const avgCharW    = ctx.measureText(AVG_SAMPLE).width / AVG_SAMPLE.length;
  const placeColW   = avgCharW * PLACE_COLS;
  const timeColW    = avgCharW * TIME_COLS;
  const leaderColW  = avgCharW * LEADER_COLS;
  const gapW        = avgCharW * FIELD_GAP_CHARS;
  const naturalW    = placeColW + gapW + timeColW + gapW + leaderColW;

  const oneCharW = Math.round(avgCharW * MARGIN_CHARS);
  const scaleX   = (colWidth - 2 * oneCharW) / naturalW;

  const color = getSlideStateColor(campaign.state);
  ctx.save();
  ctx.translate(colX + oneCharW, y);
  ctx.scale(scaleX, 1);
  ctx.textBaseline = 'top';
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.lineJoin = 'round';
  ctx.fillStyle = color;

  let x = 0;
  ctx.textAlign = 'left';
  ctx.strokeText(place, x, 0);
  ctx.fillText(place, x, 0);
  x += placeColW + gapW;

  const timeW = ctx.measureText(time).width;
  ctx.textAlign = 'left';
  ctx.strokeText(time, x + (timeColW - timeW), 0);
  ctx.fillText(time, x + (timeColW - timeW), 0);
  x += timeColW + gapW;

  ctx.strokeText(leader, x, 0);
  ctx.fillText(leader, x, 0);

  ctx.restore();
}

export function drawWeekSeparator(
  ctx: CanvasRenderingContext2D,
  colX: number,
  y: number,
  colWidth: number,
): void {
  ctx.font = `bold ${FONT_KEY}px Arial`;
  ctx.fillStyle = 'rgb(255, 0, 0)';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText('*'.repeat(40), colX + colWidth / 2, y);
  ctx.textAlign = 'left';
}

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------

export async function renderAriseCanvas(
  allCampaigns: AriseCampaign[][],
  dates: Date[],
  onProgress?: (msg: string) => void,
): Promise<HTMLCanvasElement> {
  // Measure font to compute dynamic side margin, matching the margin used
  // inside drawCampaignLine so columns and content line up.
  const tmp    = document.createElement('canvas');
  const tmpCtx = tmp.getContext('2d')!;
  tmpCtx.font  = `${FONT_CAMP}px Arial`;
  const AVG_SAMPLE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const avgCharW   = tmpCtx.measureText(AVG_SAMPLE).width / AVG_SAMPLE.length;
  const sideMargin = Math.round(avgCharW * MARGIN_CHARS);

  const nCols = Math.max(2, simulateColumnCount(allCampaigns));
  const { colWidth, colXs } = computeColLayout(nCols, sideMargin);

  onProgress?.(`Rendering Week 1 Campaigns list (${nCols} columns)…`);

  const canvas    = document.createElement('canvas');
  canvas.width    = WIDTH;
  canvas.height   = HEIGHT;
  const ctx       = canvas.getContext('2d')!;
  if (!ctx) throw new Error('Failed to get canvas context');

  ctx.fillStyle = 'white';
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  drawBannerAndKey(ctx);

  let colIdx     = 0;
  let currentY   = CONTENT_TOP;
  let firstInCol = true;

  for (let dayIndex = 0; dayIndex < dates.length; dayIndex++) {
    const date = dates[dayIndex];

    if (dayIndex === 7) {
      const topM   = firstInCol ? 0 : DATE_TOP_MARGIN;
      const needed = topM + SEP_H;
      if (currentY + needed > CONTENT_BOTTOM && colIdx < colXs.length - 1) {
        colIdx++;
        currentY   = CONTENT_TOP;
        firstInCol = true;
      }
      const sepY = currentY + (firstInCol ? 0 : DATE_TOP_MARGIN);
      drawWeekSeparator(ctx, colXs[colIdx], sepY, colWidth);
      currentY   = sepY + SEP_H;
      firstInCol = false;
    }

    const campaigns = allCampaigns[dayIndex];
    if (campaigns.length === 0) continue;

    let remaining = [...campaigns];
    while (remaining.length > 0) {
      const topM      = firstInCol ? 0 : DATE_TOP_MARGIN;
      const minNeeded = topM + DATE_BLOCK_H + DATE_HDR_SPACE + LINE_SPACING;

      if (currentY + minNeeded > CONTENT_BOTTOM) {
        if (colIdx >= colXs.length - 1) break;
        colIdx++;
        currentY   = CONTENT_TOP;
        firstInCol = true;
      }

      const topM2   = firstInCol ? 0 : DATE_TOP_MARGIN;
      const headerY = currentY + topM2;
      drawDateHeader(ctx, date, colXs[colIdx], headerY, colWidth);

      const lineY = headerY + DATE_BLOCK_H + DATE_HDR_SPACE;
      const avail = CONTENT_BOTTOM - lineY;
      const nFit  = Math.max(0, Math.floor(avail / LINE_SPACING));

      if (nFit === 0) {
        if (colIdx >= colXs.length - 1) break;
        colIdx++;
        currentY   = CONTENT_TOP;
        firstInCol = true;
        continue;
      }

      const batch = remaining.slice(0, nFit);
      batch.forEach((c, j) => {
        drawCampaignLine(ctx, c, colXs[colIdx], lineY + j * LINE_SPACING, colWidth);
      });

      currentY   = lineY + batch.length * LINE_SPACING;
      firstInCol = false;
      remaining  = remaining.slice(nFit);
    }
  }

  return canvas;
}
