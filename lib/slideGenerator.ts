/**
 * Slide Generator
 *
 * All JPEG slide canvas logic extracted from app/admin/generate-slides/page.tsx
 * into a parameter-driven function. Used by:
 *   - app/admin/generate-slides/page.tsx  (with optional custom start date)
 *   - app/app/page.tsx admin quick-action  (always uses upcomingCampaignStart)
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import JSZip from 'jszip';
import {
  getSlideStateColor,
  formatSlideDateText,
  formatSlideTime,
  STATE_CODES,
} from '@/lib/slideLayout';

// ---------------------------------------------------------------------------
// Canvas constants  (match generate-slides/page.tsx exactly)
// ---------------------------------------------------------------------------

const DPI                 = 300;
const SLIDE_WIDTH         = Math.floor(7.5 * DPI);  // 2250 px
const SLIDE_HEIGHT        = Math.floor(10  * DPI);  // 3000 px

const FONT_SIZES = { title: 72, colorKey: 54, date: 78, campaign: 84 } as const;

const PLACE_COLS      = 18;
const TIME_COLS       = 9;
const LEADER_COLS     = 12;
const MOBILE_MAX_COLS = 10;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SlideCampaign {
  id: string;
  date: string;
  state: string;
  place: string;
  time: string;
  leader: string;
  mobile: string | null;
  category: string | null;
}

export interface GenerateSlidesOptions {
  supabase: SupabaseClient;
  /** First date of the two-week window to render. */
  startDate: Date;
  adminStatus?: string | null;
  userState?: string | null;
  /** Optional callback invoked with status messages as generation proceeds. */
  onProgress?: (msg: string) => void;
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

function px(inches: number): number {
  return Math.floor(inches * DPI);
}

function dateHeadingsFrom(startDate: Date): Date[] {
  return Array.from({ length: 14 }, (_, i) => {
    const d = new Date(startDate);
    d.setDate(d.getDate() + i);
    return d;
  });
}

async function fetchCampaigns(
  client: SupabaseClient,
  date: Date,
  adminStatus: string | null | undefined,
  userState: string | null | undefined,
): Promise<SlideCampaign[]> {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const dateStr = `${y}-${m}-${d}`;

  let q = client
    .from('campaigns')
    .select('*')
    .eq('date', dateStr)
    .order('state', { ascending: true })
    .order('place', { ascending: true })
    .order('time', { ascending: true });

  if (adminStatus === 'SR' && userState) {
    q = q.eq('state', userState.toUpperCase().trim());
  }
  const { data } = await q;
  return (data ?? []) as SlideCampaign[];
}

async function fetchMessage(
  client: SupabaseClient,
  date: Date,
): Promise<string | null> {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const { data } = await client
    .from('campaign_messages')
    .select('message')
    .eq('date', `${y}-${m}-${d}`)
    .single();
  return data?.message ?? null;
}

function drawFestiveBanner(
  ctx: CanvasRenderingContext2D,
  date: Date,
  spaceEnd: number,
  width: number,
): number {
  if (!(date.getMonth() === 11 && date.getDate() === 31)) return 0;
  const text = 'Happy New Year!';
  const padding = px(0.08);
  ctx.font = `bold italic ${FONT_SIZES.date}px Arial`;
  const tw = ctx.measureText(text).width;
  const bw = tw + 2 * padding;
  const bh = FONT_SIZES.date + 2 * padding;
  const bx = (width - bw) / 2;
  const by = spaceEnd - bh;
  ctx.fillStyle = 'rgb(255, 165, 0)';
  ctx.fillRect(bx, by, bw, bh);
  ctx.fillStyle = 'rgb(0, 0, 0)';
  ctx.fillText(text, bx + padding, by + padding + FONT_SIZES.date * 0.8);
  return bh;
}

function drawMessageBanner(
  ctx: CanvasRenderingContext2D,
  message: string,
  spaceStart: number,
  width: number,
): number {
  const padding = px(0.1);
  const maxW = width - padding * 4;
  ctx.font = `bold italic ${FONT_SIZES.date}px Arial`;

  const words = message.split(' ');
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxW) {
      if (line) lines.push(line);
      line = word;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);

  const th = FONT_SIZES.date;
  const ls = th * 0.3;
  const totalH = lines.length * th + (lines.length - 1) * ls;
  const vp = padding * 1.5;
  const bh = totalH + 2 * vp;
  const bw = Math.max(...lines.map(l => ctx.measureText(l).width)) + 2 * padding;
  const bx = (width - bw) / 2;

  ctx.fillStyle = 'rgb(255, 165, 0)';
  ctx.fillRect(bx, spaceStart, bw, bh);
  ctx.fillStyle = 'rgb(0, 0, 0)';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  lines.forEach((l, i) => {
    ctx.fillText(l, width / 2, spaceStart + vp + i * (th + ls));
  });
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  return bh;
}

async function renderSlide(
  client: SupabaseClient,
  startDateIndex: number,
  startCampaignIndex: number,
  dateHeadings: Date[],
  adminStatus: string | null | undefined,
  userState: string | null | undefined,
): Promise<{ canvas: HTMLCanvasElement; nextDateIndex: number | null; nextCampaignIndex: number }> {
  const canvas = document.createElement('canvas');
  canvas.width  = SLIDE_WIDTH;
  canvas.height = SLIDE_HEIGHT;
  const ctx = canvas.getContext('2d')!;
  if (!ctx) throw new Error('Failed to get canvas context');

  // White background
  ctx.fillStyle = 'white';
  ctx.fillRect(0, 0, SLIDE_WIDTH, SLIDE_HEIGHT);

  // Red title banner
  const bannerH = px(0.5);
  ctx.fillStyle = 'rgb(255, 0, 0)';
  ctx.fillRect(0, 0, SLIDE_WIDTH, bannerH);
  ctx.fillStyle = 'white';
  ctx.font = `bold ${FONT_SIZES.title}px Arial`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('A.F.J UPCOMING CAMPAIGNS', SLIDE_WIDTH / 2, bannerH / 2);

  // Colour key row
  ctx.font = `bold ${FONT_SIZES.colorKey}px Arial`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  const keyLabel = 'Colour Key:    ';
  let totalW = ctx.measureText(keyLabel).width;
  STATE_CODES.forEach((s, i) => {
    totalW += ctx.measureText(s).width;
    if (i < STATE_CODES.length - 1) totalW += ctx.measureText('   ').width;
  });
  let xPos = (SLIDE_WIDTH - totalW) / 2;
  const yKey = px(0.6) + px(0.1);
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

  // Campaign entries
  const dateStartTop  = px(1.0);
  const dateLeft      = px(0.5);
  const dateHeight    = px(0.35);
  const lineSpacing   = px(0.3);
  const bottomMargin  = px(0.5);
  let currentY = dateStartTop;
  let previousWeek: number | null = startDateIndex > 0 ? (startDateIndex >= 7 ? 2 : 1) : null;
  let currentCampaignIndex = startCampaignIndex;

  for (let i = startDateIndex; i < dateHeadings.length; i++) {
    const date = dateHeadings[i];
    const week = i < 7 ? 1 : 2;
    const campaigns = await fetchCampaigns(client, date, adminStatus, userState);

    if (campaigns.length === 0) { previousWeek = week; currentCampaignIndex = 0; continue; }

    const toRender = campaigns.slice(currentCampaignIndex);
    if (toRender.length === 0)  { previousWeek = week; currentCampaignIndex = 0; continue; }

    const topMargin       = (previousWeek !== null || currentY > dateStartTop) ? px(0.1) : 0;
    const dateHeaderSpace = px(0.05);

    ctx.font = `bold ${FONT_SIZES.campaign}px "Courier New", monospace`;
    const campaignLineH = FONT_SIZES.campaign;
    const avail = SLIDE_HEIGHT - bottomMargin - currentY - topMargin - dateHeight - dateHeaderSpace;
    const maxFit = Math.max(0, Math.floor((avail + campaignLineH) / lineSpacing));
    const nFit   = Math.min(toRender.length, maxFit);

    if (nFit === 0) return { canvas, nextDateIndex: i, nextCampaignIndex: currentCampaignIndex };

    const finalCampaigns = toRender.slice(0, nFit);
    const willContinue   = nFit < toRender.length;

    // Date header (yellow background)
    currentY += topMargin;
    ctx.font = `italic ${FONT_SIZES.date}px Arial`;
    const dateText   = formatSlideDateText(date);
    const dtMetrics  = ctx.measureText(dateText);
    const dtH        = FONT_SIZES.date;
    const pad        = px(0.08);
    const ybW        = dtMetrics.width + 2 * pad;
    const ybH        = dtH + 2 * pad;
    const ybX        = dateLeft;
    const ybY        = currentY + (dateHeight - ybH) / 2;
    ctx.fillStyle = 'rgb(255, 255, 0)';
    ctx.fillRect(ybX, ybY, ybW, ybH);
    ctx.fillStyle = 'rgb(130, 0, 0)';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(dateText, ybX + pad, ybY + pad);

    // Campaign lines (scaled to fill width edge-to-edge)
    const campaignY = currentY + dateHeight + dateHeaderSpace;
    ctx.font = `bold ${FONT_SIZES.campaign}px "Courier New", monospace`;
    const oneCharW        = Math.round(ctx.measureText('M').width);
    const availW          = SLIDE_WIDTH - 2 * oneCharW;
    const totalCols       = PLACE_COLS + 1 + TIME_COLS + 1 + LEADER_COLS + 1 + MOBILE_MAX_COLS;
    const naturalW        = ctx.measureText('M'.repeat(totalCols)).width;
    const scaleX          = availW / naturalW;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';

    finalCampaigns.forEach((c, j) => {
      let place = c.place;
      const cat = c.category ?? 'TWOL';
      if (cat !== 'TWOL') place = `${place} ${cat}`;
      if (place.length > PLACE_COLS) place = place.substring(0, PLACE_COLS);

      const time   = formatSlideTime(c.time);
      const leader = c.leader.length > LEADER_COLS ? c.leader.substring(0, LEADER_COLS) : c.leader;
      const mobile = (c.mobile ?? '').replace(/\s/g, '');

      const text = `${place.padEnd(PLACE_COLS)} ${time.padStart(TIME_COLS)} ${leader.padEnd(LEADER_COLS)} ${mobile}`;
      ctx.fillStyle = getSlideStateColor(c.state);
      ctx.save();
      ctx.translate(oneCharW, campaignY + j * lineSpacing);
      ctx.scale(scaleX, 1);
      ctx.fillText(text, 0, 0);
      ctx.restore();
    });

    const campaignsH = finalCampaigns.length * campaignLineH
      + (finalCampaigns.length - 1) * (lineSpacing - campaignLineH);
    currentY += dateHeight + dateHeaderSpace + campaignsH + px(0.05);

    const finishingDate = currentCampaignIndex + nFit >= campaigns.length;
    if (finishingDate) {
      currentY += drawFestiveBanner(ctx, date, currentY + px(0.2), SLIDE_WIDTH);

      const msg = await fetchMessage(client, date);
      if (msg) {
        currentY += px(0.05) + drawMessageBanner(ctx, msg, currentY + px(0.05), SLIDE_WIDTH);
      }

      if (i === 6 && week === 1) {
        ctx.font = `bold ${FONT_SIZES.colorKey}px Arial`;
        ctx.fillStyle = 'rgb(255, 0, 0)';
        ctx.textAlign = 'center';
        ctx.fillText('*'.repeat(50), SLIDE_WIDTH / 2, currentY + px(0.05));
        currentY += px(0.4);
      }
    }

    if (willContinue) {
      return { canvas, nextDateIndex: i, nextCampaignIndex: currentCampaignIndex + nFit };
    }
    previousWeek = week;
    currentCampaignIndex = 0;
  }

  return { canvas, nextDateIndex: null, nextCampaignIndex: 0 };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generates JPEG slides for the two-week window starting at `startDate`,
 * packages them into a ZIP, and triggers a browser download.
 */
export async function generateAndDownloadSlides(options: GenerateSlidesOptions): Promise<void> {
  const { supabase: client, startDate, adminStatus, userState, onProgress } = options;

  const dateHeadings = dateHeadingsFrom(startDate);
  const slides: Blob[] = [];
  let slideNum = 1;
  let dateIdx  = 0;
  let campIdx  = 0;

  while (slideNum <= 20) {
    onProgress?.(`Generating slide ${slideNum}…`);
    const result = await renderSlide(client, dateIdx, campIdx, dateHeadings, adminStatus, userState);

    const blob = await new Promise<Blob>((resolve, reject) => {
      result.canvas.toBlob(
        b => (b ? resolve(b) : reject(new Error('Failed to create blob'))),
        'image/jpeg',
        0.95,
      );
    });
    slides.push(blob);

    if (result.nextDateIndex === null) break;
    dateIdx = result.nextDateIndex;
    campIdx = result.nextCampaignIndex;
    slideNum++;
  }

  if (slides.length === 0) {
    throw new Error('No slides generated. Check that campaigns exist in the database.');
  }

  onProgress?.(`Creating ZIP with ${slides.length} slide(s)…`);

  const zip = new JSZip();
  for (let i = 0; i < slides.length; i++) {
    zip.file(`slide_${i + 1}.jpg`, await slides[i].arrayBuffer());
  }

  const zipBlob = await zip.generateAsync({ type: 'blob' });
  const url  = URL.createObjectURL(zipBlob);
  const link = document.createElement('a');
  link.href     = url;
  link.download = 'campaign_slides.zip';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);

  onProgress?.(`Done — ${slides.length} slide(s) downloaded.`);
}
