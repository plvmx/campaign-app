/**
 * ARISE List Generator
 *
 * Renders a single landscape JPEG showing the upcoming campaign schedule:
 *   - Week 1: all 7 days (Mon → Sun)
 *   - Week 2: Mon and Tue only
 *
 * Layout: two equal columns, no phone-number column, same red banner and colour
 * key legend as the portrait Campaign Lists. A red asterisk row separates week 1
 * from week 2. Date headers are repeated when a day's campaigns overflow into the
 * right column.
 *
 * Used by the "ARISE Lists" admin quick-action in app/app/page.tsx.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  getSlideStateColor,
  formatSlideDateText,
  formatSlideTime,
  STATE_CODES,
} from '@/lib/slideLayout';

// ---------------------------------------------------------------------------
// Canvas constants
// ---------------------------------------------------------------------------

const DPI    = 300;
const WIDTH  = Math.floor(14 * DPI); // 4200 px  (14" landscape)
const HEIGHT = Math.floor(10 * DPI); // 3000 px  (10" landscape)

const FONT_TITLE = 72;
const FONT_KEY   = 54;
const FONT_DATE  = 70;
const FONT_CAMP  = 62;

const PLACE_COLS  = 20;
const TIME_COLS   = 9;
const LEADER_COLS = 15;

function apx(inches: number): number {
  return Math.floor(inches * DPI);
}

const SIDE_MARGIN    = apx(0.5);  // 150 px
const COL_GAP        = 200;       // px between columns
const COL_WIDTH      = Math.floor((WIDTH - 2 * SIDE_MARGIN - COL_GAP) / 2); // 1850 px
const LEFT_COL_X     = SIDE_MARGIN;
const RIGHT_COL_X    = SIDE_MARGIN + COL_WIDTH + COL_GAP;

const CONTENT_TOP    = apx(1.0);           // 300 px
const BOTTOM_MARGIN  = apx(0.5);           // 150 px
const CONTENT_BOTTOM = HEIGHT - BOTTOM_MARGIN; // 2850 px

const DATE_PAD       = apx(0.08); // 24 px — inner padding of the yellow date header box
const DATE_BLOCK_H   = FONT_DATE + 2 * DATE_PAD; // ~118 px
const DATE_HDR_SPACE = apx(0.05); // 15 px — gap below date header before first campaign
const DATE_TOP_MARGIN = apx(0.1); // 30 px — gap above a new date group (not first in col)
const LINE_SPACING   = apx(0.3);  // 90 px — vertical advance per campaign line

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AriseCampaign {
  id: string;
  date: string;
  state: string;
  place: string;
  time: string;
  leader: string;
  category: string | null;
}

export interface GenerateAriseOptions {
  supabase: SupabaseClient;
  /** First Monday of the two-week window. */
  startDate: Date;
  adminStatus?: string | null;
  userState?: string | null;
  /** Optional progress callback. */
  onProgress?: (msg: string) => void;
}

// ---------------------------------------------------------------------------
// Data helpers
// ---------------------------------------------------------------------------

async function fetchCampaigns(
  client: SupabaseClient,
  date: Date,
  adminStatus: string | null | undefined,
  userState: string | null | undefined,
): Promise<AriseCampaign[]> {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');

  let q = client
    .from('campaigns')
    .select('id, date, state, place, time, leader, category')
    .eq('date', `${y}-${m}-${d}`)
    .order('state', { ascending: true })
    .order('place', { ascending: true })
    .order('time',  { ascending: true });

  if (adminStatus === 'SR' && userState) {
    q = q.eq('state', userState.toUpperCase().trim());
  }

  const { data } = await q;
  return (data ?? []) as AriseCampaign[];
}

// ---------------------------------------------------------------------------
// Canvas draw helpers
// ---------------------------------------------------------------------------

function drawBannerAndKey(ctx: CanvasRenderingContext2D): void {
  // Red title banner
  const bannerH = apx(0.5);
  ctx.fillStyle = 'rgb(255, 0, 0)';
  ctx.fillRect(0, 0, WIDTH, bannerH);
  ctx.fillStyle = 'white';
  ctx.font = `bold ${FONT_TITLE}px Arial`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('A.F.J UPCOMING CAMPAIGNS', WIDTH / 2, bannerH / 2);

  // Colour key row
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

function drawDateHeader(
  ctx: CanvasRenderingContext2D,
  date: Date,
  colX: number,
  y: number,
): void {
  ctx.font = `italic ${FONT_DATE}px Arial`;
  const text = formatSlideDateText(date);
  const tw   = ctx.measureText(text).width;
  const bw   = Math.min(tw + 2 * DATE_PAD, COL_WIDTH);
  const bh   = DATE_BLOCK_H;
  ctx.fillStyle = 'rgb(255, 255, 0)';
  ctx.fillRect(colX, y, bw, bh);
  ctx.fillStyle = 'rgb(130, 0, 0)';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(text, colX + DATE_PAD, y + DATE_PAD);
}

function drawCampaignLine(
  ctx: CanvasRenderingContext2D,
  campaign: AriseCampaign,
  colX: number,
  y: number,
): void {
  let place = campaign.place;
  const cat = campaign.category ?? 'TWOL';
  if (cat !== 'TWOL') place = `${place} ${cat}`;
  if (place.length > PLACE_COLS) place = place.substring(0, PLACE_COLS);

  const time   = formatSlideTime(campaign.time);
  const leader = campaign.leader.length > LEADER_COLS
    ? campaign.leader.substring(0, LEADER_COLS)
    : campaign.leader;

  const text = `${place.padEnd(PLACE_COLS)} ${time.padStart(TIME_COLS)} ${leader.padEnd(LEADER_COLS)}`;

  ctx.font = `bold ${FONT_CAMP}px "Courier New", monospace`;
  const oneCharW = Math.round(ctx.measureText('M').width);
  const totalCols = PLACE_COLS + 1 + TIME_COLS + 1 + LEADER_COLS;
  const naturalW  = ctx.measureText('M'.repeat(totalCols)).width;
  const scaleX    = (COL_WIDTH - 2 * oneCharW) / naturalW;

  ctx.fillStyle = getSlideStateColor(campaign.state);
  ctx.save();
  ctx.translate(colX + oneCharW, y);
  ctx.scale(scaleX, 1);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(text, 0, 0);
  ctx.restore();
}

function drawWeekSeparator(
  ctx: CanvasRenderingContext2D,
  colX: number,
  y: number,
): void {
  ctx.font = `bold ${FONT_KEY}px Arial`;
  ctx.fillStyle = 'rgb(255, 0, 0)';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText('*'.repeat(40), colX + COL_WIDTH / 2, y);
  ctx.textAlign = 'left';
}

// ---------------------------------------------------------------------------
// Canvas renderer
// ---------------------------------------------------------------------------

async function renderAriseCanvas(
  client: SupabaseClient,
  startDate: Date,
  adminStatus: string | null | undefined,
  userState: string | null | undefined,
  onProgress?: (msg: string) => void,
): Promise<HTMLCanvasElement> {
  const canvas = document.createElement('canvas');
  canvas.width  = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext('2d')!;
  if (!ctx) throw new Error('Failed to get canvas context');

  // White background
  ctx.fillStyle = 'white';
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  drawBannerAndKey(ctx);

  // Build the 9 date targets: week-1 days 0–6, week-2 Mon+Tue = days 7–8
  const dates = Array.from({ length: 9 }, (_, i) => {
    const d = new Date(startDate);
    d.setDate(d.getDate() + i);
    return d;
  });

  const colXs: [number, number] = [LEFT_COL_X, RIGHT_COL_X];
  let colIdx    = 0;
  let currentY  = CONTENT_TOP;
  let firstInCol = true;

  // Separator height (one line of * at FONT_KEY plus small bottom gap)
  const SEP_H = FONT_KEY + apx(0.08);

  for (let dayIndex = 0; dayIndex < dates.length; dayIndex++) {
    const date = dates[dayIndex];

    // ── Week separator before day 7 (first day of week 2) ──────────────────
    if (dayIndex === 7) {
      const topM   = firstInCol ? 0 : DATE_TOP_MARGIN;
      const needed = topM + SEP_H;

      if (currentY + needed > CONTENT_BOTTOM) {
        if (colIdx < 1) {
          colIdx++;
          currentY  = CONTENT_TOP;
          firstInCol = true;
        }
      }

      const sepY = currentY + (firstInCol ? 0 : DATE_TOP_MARGIN);
      drawWeekSeparator(ctx, colXs[colIdx], sepY);
      currentY   = sepY + SEP_H;
      firstInCol = false;
    }

    onProgress?.(`Fetching day ${dayIndex + 1} of ${dates.length}…`);

    const campaigns = await fetchCampaigns(client, date, adminStatus, userState);
    if (campaigns.length === 0) continue;

    // Place as many campaigns as fit in the current (then next) column
    let remaining = [...campaigns];

    while (remaining.length > 0) {
      const topM     = firstInCol ? 0 : DATE_TOP_MARGIN;
      // Minimum needed = margin + date header + gap + at least one campaign line
      const minNeeded = topM + DATE_BLOCK_H + DATE_HDR_SPACE + LINE_SPACING;

      if (currentY + minNeeded > CONTENT_BOTTOM) {
        // Overflow to right column — if already in right column, stop
        if (colIdx >= 1) break;
        colIdx++;
        currentY   = CONTENT_TOP;
        firstInCol = true;
      }

      const topM2   = firstInCol ? 0 : DATE_TOP_MARGIN;
      const headerY = currentY + topM2;
      drawDateHeader(ctx, date, colXs[colIdx], headerY);

      const lineY = headerY + DATE_BLOCK_H + DATE_HDR_SPACE;
      const avail = CONTENT_BOTTOM - lineY;
      const nFit  = Math.max(0, Math.floor(avail / LINE_SPACING));

      if (nFit === 0) {
        // No room for even one line; try next column
        if (colIdx >= 1) break;
        colIdx++;
        currentY   = CONTENT_TOP;
        firstInCol = true;
        continue;
      }

      const batch = remaining.slice(0, nFit);
      batch.forEach((c, j) => {
        drawCampaignLine(ctx, c, colXs[colIdx], lineY + j * LINE_SPACING);
      });

      currentY   = lineY + batch.length * LINE_SPACING;
      firstInCol = false;
      remaining  = remaining.slice(nFit);
    }
  }

  return canvas;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Renders the ARISE campaign list as a single landscape JPEG and triggers a
 * browser download.
 */
export async function generateAndDownloadAriseList(options: GenerateAriseOptions): Promise<void> {
  const { supabase: client, startDate, adminStatus, userState, onProgress } = options;

  onProgress?.('Rendering ARISE list…');
  const canvas = await renderAriseCanvas(client, startDate, adminStatus, userState, onProgress);

  onProgress?.('Creating JPEG…');
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      b => (b ? resolve(b) : reject(new Error('Failed to create JPEG blob'))),
      'image/jpeg',
      0.95,
    );
  });

  const url  = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href     = url;
  link.download = 'arise_campaign_list.jpg';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);

  onProgress?.('Done — ARISE list downloaded.');
}
