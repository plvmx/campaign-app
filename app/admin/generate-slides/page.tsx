'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import MobileLayout from '@/components/MobileLayout';
import { useUser } from '@/contexts/UserContext';
import { supabase } from '@/lib/supabaseClient';
import JSZip from 'jszip';
import { getErrorMessage } from '@/lib/errorUtils';

// Constants matching Python code
const DPI = 300;
const SLIDE_WIDTH_INCHES = 7.5;
const SLIDE_HEIGHT_INCHES = 10;
const SLIDE_WIDTH = Math.floor(SLIDE_WIDTH_INCHES * DPI);
const SLIDE_HEIGHT = Math.floor(SLIDE_HEIGHT_INCHES * DPI);

const STATE_COLORS: Record<string, string> = {
  'ACT': 'rgb(0, 176, 240)',
  'NSW': 'rgb(0, 0, 0)',
  'NT': 'rgb(0, 46, 138)',
  'QLD': 'rgb(255, 0, 0)',
  'SA': 'rgb(0, 176, 80)',
  'TAS': 'rgb(0, 0, 255)',
  'VIC': 'rgb(234, 107, 20)',
  'WA': 'rgb(204, 0, 255)'
};

// Helper function to get state color with case-insensitive lookup
const getStateColor = (state: string): string => {
  const upperState = state.toUpperCase();
  return STATE_COLORS[upperState] || 'rgb(0, 0, 0)';
};

const STATE_CODES = ['ACT', 'NSW', 'NT', 'QLD', 'SA', 'TAS', 'VIC', 'WA'];

const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

// Font sizes in pixels at 300 DPI
const FONT_SIZES = {
  title: 72,
  colorKey: 54,
  date: 78,
  campaign: 84
};

// Column widths (in monospace characters) for campaign lines.
const PLACE_COLS      = 18;  // place name — truncated if longer
const TIME_COLS       = 9;   // time e.g. " 10:30 AM"
const LEADER_COLS     = 12;  // leader name — truncated if longer
const MOBILE_MAX_COLS = 10;  // AU mobile = 10 digits; last column, NOT padded

interface Campaign {
  id: string;
  date: string;
  state: string;
  place: string;
  time: string;
  leader: string;
  mobile: string;
  botj: boolean | string | number | null;
  tl_ok: boolean;
  sr_ok: boolean;
}

export default function GenerateSlidesPage() {
  const router = useRouter();
  const { user, isAdmin, adminStatus, userState, isLoading: isUserLoading } = useUser();
  const [hasAccess, setHasAccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [progress, setProgress] = useState('');
  const [customStartDate, setCustomStartDate] = useState<string>('');

  useEffect(() => {
    if (isUserLoading) return;
    if (!user) { router.push('/login'); return; }
    if (!isAdmin && adminStatus !== 'SR') {
      setError('You do not have permission to access this page');
      return;
    }
    setHasAccess(true);
  }, [isUserLoading, user, isAdmin, adminStatus, router]);

  const inchesToPixels = (inches: number): number => {
    return Math.floor(inches * DPI);
  };

  const getOrdinalSuffix = (day: number): string => {
    if (day >= 11 && day <= 13) return 'th';
    const lastDigit = day % 10;
    switch (lastDigit) {
      case 1: return 'st';
      case 2: return 'nd';
      case 3: return 'rd';
      default: return 'th';
    }
  };

  const formatDateText = (date: Date): string => {
    // getDay() returns 0=Sunday, 1=Monday, etc.
    // Convert to match DAY_NAMES array where Monday is at index 0
    const jsDay = date.getDay();
    const dayIndex = jsDay === 0 ? 6 : jsDay - 1; // Convert Sunday (0) to 6, others shift down by 1
    const dayName = DAY_NAMES[dayIndex];
    const dayNum = date.getDate();
    const ordinal = getOrdinalSuffix(dayNum);
    const monthName = MONTH_NAMES[date.getMonth()];
    return `${dayName} ${dayNum}${ordinal} ${monthName}`;
  };

  const formatTime = (timeStr: string): string => {
    // Handle ISO timestamp format
    let cleanTime = timeStr;
    if (timeStr.includes('T')) {
      cleanTime = timeStr.split('T')[1]?.split('.')[0] || timeStr;
    }
    
    // Extract hours and minutes only (remove seconds)
    const [hours, minutes] = cleanTime.split(':');
    const hour = parseInt(hours, 10);
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const displayHour = hour % 12 || 12;
    return `${displayHour}:${minutes} ${ampm}`;
  };

  const calculateStartDate = (): Date => {
    const today = new Date();
    const currentWeekday = today.getDay(); // 0=Sunday, 1=Monday, ..., 6=Saturday
    
    // Convert to Python's weekday format (0=Monday, 6=Sunday)
    const pythonWeekday = currentWeekday === 0 ? 6 : currentWeekday - 1;
    
    if (pythonWeekday <= 2) { // Monday, Tuesday, or Wednesday
      const daysToMonday = -pythonWeekday;
      const startDate = new Date(today);
      startDate.setDate(startDate.getDate() + daysToMonday);
      return startDate;
    } else { // Thursday, Friday, Saturday, or Sunday
      const daysUntilMonday = 7 - pythonWeekday;
      const startDate = new Date(today);
      startDate.setDate(startDate.getDate() + daysUntilMonday);
      return startDate;
    }
  };

  const getDateHeadings = (): Date[] => {
    let startDate: Date;
    if (customStartDate) {
      // Parse date string (YYYY-MM-DD) as local date to avoid timezone issues
      const [year, month, day] = customStartDate.split('-').map(Number);
      startDate = new Date(year, month - 1, day);
      startDate.setHours(0, 0, 0, 0);
    } else {
      startDate = calculateStartDate();
    }
    const dates: Date[] = [];
    for (let i = 0; i < 14; i++) {
      const date = new Date(startDate);
      date.setDate(date.getDate() + i);
      dates.push(date);
    }
    return dates;
  };

  const fetchCampaignsByDate = async (date: Date): Promise<Campaign[]> => {
    // Format date in local timezone to avoid timezone issues
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const dateStr = `${year}-${month}-${day}`;
    
    let query = supabase
      .from('campaigns')
      .select('*')
      .eq('date', dateStr)
      .order('state', { ascending: true })
      .order('place', { ascending: true })
      .order('time', { ascending: true });
    if (adminStatus === 'SR' && userState) {
      query = query.eq('state', userState.toUpperCase().trim());
    }
    const { data, error } = await query;
    
    if (error) {
      return [];
    }
    
    return data || [];
  };

  const fetchMessageForDate = async (date: Date): Promise<string | null> => {
    // Format date in local timezone to avoid timezone issues
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const dateStr = `${year}-${month}-${day}`;
    
    const { data, error } = await supabase
      .from('campaign_messages')
      .select('message')
      .eq('date', dateStr)
      .single();
    
    if (error) {
      return null;
    }
    
    return data?.message || null;
  };

  const drawFestiveBanner = (
    ctx: CanvasRenderingContext2D,
    date: Date,
    spaceStart: number,
    spaceEnd: number,
    width: number
  ): number => {
    let bannerText: string | null = null;
    const bannerColor = 'rgb(255, 165, 0)';
    const textColor = 'rgb(0, 0, 0)';
    
    // Check for December 31st - Happy New Year
    if (date.getMonth() === 11 && date.getDate() === 31) {
      bannerText = 'Happy New Year!';
    }
    
    if (!bannerText) return 0;
    
    const padding = inchesToPixels(0.08);
    ctx.font = `bold italic ${FONT_SIZES.date}px Arial`;
    const textMetrics = ctx.measureText(bannerText);
    const textHeight = FONT_SIZES.date;
    
    const bgWidth = textMetrics.width + (2 * padding);
    const bgHeight = textHeight + (2 * padding);
    const bgLeft = (width - bgWidth) / 2;
    const bgTop = spaceEnd - bgHeight;
    
    ctx.fillStyle = bannerColor;
    ctx.fillRect(bgLeft, bgTop, bgWidth, bgHeight);
    
    ctx.fillStyle = textColor;
    ctx.fillText(bannerText, bgLeft + padding, bgTop + padding + textHeight * 0.8);
    
    return bgHeight;
  };

  const drawMessageBanner = (
    ctx: CanvasRenderingContext2D,
    message: string,
    spaceStart: number,
    spaceEnd: number,
    width: number
  ): number => {
    const bannerColor = 'rgb(255, 165, 0)'; // Bright orange
    const textColor = 'rgb(0, 0, 0)'; // Black
    
    const padding = inchesToPixels(0.1);
    const maxWidth = width - (padding * 4); // More conservative max width
    
    // Set font for measuring (bold italic)
    ctx.font = `bold italic ${FONT_SIZES.date}px Arial`;
    
    // Split message into lines if needed
    const words = message.split(' ');
    const lines: string[] = [];
    let currentLine = '';
    
    words.forEach(word => {
      const testLine = currentLine ? `${currentLine} ${word}` : word;
      const metrics = ctx.measureText(testLine);
      
      if (metrics.width > maxWidth) {
        if (currentLine) lines.push(currentLine);
        currentLine = word;
      } else {
        currentLine = testLine;
      }
    });
    
    if (currentLine) lines.push(currentLine);
    
    // Calculate dimensions with proper vertical padding
    const textHeight = FONT_SIZES.date;
    const lineSpacing = textHeight * 0.3; // Space between lines
    const totalTextHeight = (lines.length * textHeight) + ((lines.length - 1) * lineSpacing);
    const verticalPadding = padding * 1.5; // Extra vertical padding for better centering
    const bgHeight = totalTextHeight + (2 * verticalPadding);
    
    // Find widest line
    let maxLineWidth = 0;
    lines.forEach(line => {
      const metrics = ctx.measureText(line);
      if (metrics.width > maxLineWidth) maxLineWidth = metrics.width;
    });
    
    const bgWidth = maxLineWidth + (2 * padding);
    const bgLeft = (width - bgWidth) / 2;
    const bgTop = spaceStart;
    
    // Draw background
    ctx.fillStyle = bannerColor;
    ctx.fillRect(bgLeft, bgTop, bgWidth, bgHeight);
    
    // Draw text lines centered vertically in the banner
    ctx.fillStyle = textColor;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    
    const textStartY = bgTop + verticalPadding;
    
    lines.forEach((line, index) => {
      const yPos = textStartY + (index * (textHeight + lineSpacing));
      ctx.fillText(line, width / 2, yPos);
    });
    
    // Reset text settings
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    
    return bgHeight;
  };

  const renderSlide = async (
    startDateIndex: number,
    startCampaignIndex: number
  ): Promise<{ canvas: HTMLCanvasElement; nextDateIndex: number | null; nextCampaignIndex: number }> => {
    const canvas = document.createElement('canvas');
    canvas.width = SLIDE_WIDTH;
    canvas.height = SLIDE_HEIGHT;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Failed to get canvas context');

    // White background
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, SLIDE_WIDTH, SLIDE_HEIGHT);

    // 1. Red banner at top
    const bannerHeight = inchesToPixels(0.5);
    ctx.fillStyle = 'rgb(255, 0, 0)';
    ctx.fillRect(0, 0, SLIDE_WIDTH, bannerHeight);
    
    ctx.fillStyle = 'white';
    ctx.font = `bold ${FONT_SIZES.title}px Arial`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('A.F.J UPCOMING CAMPAIGNS', SLIDE_WIDTH / 2, bannerHeight / 2);

    // 2. Color Key banner
    const colorKeyTop = inchesToPixels(0.6);
    ctx.font = `bold ${FONT_SIZES.colorKey}px Arial`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    
    const keyLabel = 'Colour Key:    ';
    const keyLabelWidth = ctx.measureText(keyLabel).width;
    
    let totalTextWidth = keyLabelWidth;
    STATE_CODES.forEach((state, i) => {
      totalTextWidth += ctx.measureText(state).width;
      if (i < STATE_CODES.length - 1) {
        totalTextWidth += ctx.measureText('   ').width;
      }
    });
    
    let xPos = (SLIDE_WIDTH - totalTextWidth) / 2;
    const yPos = colorKeyTop + inchesToPixels(0.1);
    
    ctx.fillStyle = 'rgb(130, 0, 0)';
    ctx.fillText(keyLabel, xPos, yPos);
    xPos += keyLabelWidth;
    
    STATE_CODES.forEach((state, i) => {
      ctx.fillStyle = getStateColor(state);
      ctx.fillText(state, xPos, yPos);
      xPos += ctx.measureText(state).width;
      if (i < STATE_CODES.length - 1) {
        const spacer = '   ';
        ctx.fillStyle = 'rgb(0, 0, 0)';
        ctx.fillText(spacer, xPos, yPos);
        xPos += ctx.measureText(spacer).width;
      }
    });

    // 3. Date entries and campaigns
    const dateStartTop = inchesToPixels(1.0);
    const dateLeft = inchesToPixels(0.5);
    const dateHeight = inchesToPixels(0.35);
    const lineSpacing = inchesToPixels(0.3); // Reduced from 0.4 for tighter campaign line spacing
    const bottomMargin = inchesToPixels(0.5);
    let currentY = dateStartTop;
    
    const dateHeadings = getDateHeadings();
    let previousWeek: number | null = startDateIndex > 0 ? (startDateIndex >= 7 ? 2 : 1) : null;
    let currentCampaignIndex = startCampaignIndex;

    for (let i = startDateIndex; i < dateHeadings.length; i++) {
      const date = dateHeadings[i];
      const week = i < 7 ? 1 : 2;
      const campaigns = await fetchCampaignsByDate(date);
      
      if (campaigns.length === 0) {
        previousWeek = week;
        currentCampaignIndex = 0;
        continue;
      }
      
      const campaignsToRender = campaigns.slice(currentCampaignIndex);
      if (campaignsToRender.length === 0) {
        previousWeek = week;
        currentCampaignIndex = 0;
        continue;
      }
      
      // Calculate space needed
      const topMargin = (previousWeek !== null || currentY > dateStartTop) ? inchesToPixels(0.1) : 0;
      const dateHeaderHeight = dateHeight;
      const dateHeaderSpacing = inchesToPixels(0.05);
      
      // Use monospace font for campaigns
      ctx.font = `bold ${FONT_SIZES.campaign}px "Courier New", monospace`;
      const campaignLineHeight = FONT_SIZES.campaign;
      
      // Calculate how many campaigns fit
      const availableHeight = SLIDE_HEIGHT - bottomMargin - currentY - topMargin - dateHeaderHeight - dateHeaderSpacing;
      const maxCampaignsFit = Math.max(0, Math.floor((availableHeight + campaignLineHeight) / lineSpacing));
      const campaignsThatFit = Math.min(campaignsToRender.length, maxCampaignsFit);
      
      if (campaignsThatFit === 0) {
        return { canvas, nextDateIndex: i, nextCampaignIndex: currentCampaignIndex };
      }
      
      const finalCampaigns = campaignsToRender.slice(0, campaignsThatFit);
      const willContinue = campaignsThatFit < campaignsToRender.length;
      
      // Draw date header
      currentY += topMargin;
      
      ctx.font = `italic ${FONT_SIZES.date}px Arial`;
      const dateText = formatDateText(date);
      const dateMetrics = ctx.measureText(dateText);
      const dateTextHeight = FONT_SIZES.date;
      
      const padding = inchesToPixels(0.08);
      const yellowBgWidth = dateMetrics.width + (2 * padding);
      const yellowBgHeight = dateTextHeight + (2 * padding);
      const yellowBgLeft = dateLeft;
      const yellowBgTop = currentY + (dateHeight - yellowBgHeight) / 2;
      
      ctx.fillStyle = 'rgb(255, 255, 0)';
      ctx.fillRect(yellowBgLeft, yellowBgTop, yellowBgWidth, yellowBgHeight);
      
      ctx.fillStyle = 'rgb(130, 0, 0)';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(dateText, yellowBgLeft + padding, yellowBgTop + padding);
      
      // Draw campaigns
      const campaignY = currentY + dateHeaderHeight + dateHeaderSpacing;
      
      // Scale campaign text to fill edge-to-edge with exactly 1-char margin each side.
      // The scale is calculated from the actual column layout, so it self-adjusts if
      // column widths change above.
      ctx.font = `bold ${FONT_SIZES.campaign}px "Courier New", monospace`;

      // In Courier New every character has identical width — measure one char.
      const oneCharWidth = Math.round(ctx.measureText('M').width);
      const campaignX = oneCharWidth;                          // 1-char left margin
      const availableWidth = SLIDE_WIDTH - 2 * oneCharWidth;  // right margin mirrors left

      // Total characters in one line: columns + 3 separator spaces.
      // Mobile is the last column and is NOT padded, so MOBILE_MAX_COLS is its natural max.
      const totalCols = PLACE_COLS + 1 + TIME_COLS + 1 + LEADER_COLS + 1 + MOBILE_MAX_COLS;
      const naturalLineWidth = ctx.measureText('M'.repeat(totalCols)).width;
      const campaignScaleX = availableWidth / naturalLineWidth;

      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';

      finalCampaigns.forEach((campaign, j) => {
        let place = campaign.place;

        // Check BOTJ - handle different data types (boolean, string, number)
        const bofjValue = campaign.botj;
        let shouldAppendBOTJ = false;

        if (typeof bofjValue === 'boolean') {
          shouldAppendBOTJ = bofjValue;
        } else if (typeof bofjValue === 'number') {
          shouldAppendBOTJ = bofjValue === 1;
        } else if (typeof bofjValue === 'string') {
          shouldAppendBOTJ = bofjValue === '1' || bofjValue.toLowerCase() === 'yes' || bofjValue.toLowerCase() === 'true';
        }

        if (shouldAppendBOTJ) {
          place = `${place} BOTJ`;
        }
        if (place.length > PLACE_COLS) {
          place = place.substring(0, PLACE_COLS);
        }

        const time = formatTime(campaign.time);
        const leader = campaign.leader.length > LEADER_COLS
          ? campaign.leader.substring(0, LEADER_COLS)
          : campaign.leader;
        const mobile = (campaign.mobile || '').replace(/\s/g, '');

        // Format with fixed column widths.
        // Mobile is the last column — do NOT pad it; trailing spaces would create a visual right margin.
        const placePadded  = place.padEnd(PLACE_COLS, ' ');
        const timePadded   = time.padStart(TIME_COLS, ' ');
        const leaderPadded = leader.padEnd(LEADER_COLS, ' ');
        const campaignText = `${placePadded} ${timePadded} ${leaderPadded} ${mobile}`;

        // Draw with horizontal compression to fill the available width.
        // translate → scale(x only) → fillText at origin → restore keeps y-positions intact.
        const yDrawPos = campaignY + (j * lineSpacing);
        ctx.fillStyle = getStateColor(campaign.state);
        ctx.save();
        ctx.translate(campaignX, yDrawPos);
        ctx.scale(campaignScaleX, 1);
        ctx.fillText(campaignText, 0, 0);
        ctx.restore();
      });
      
      // Update position
      const campaignsHeight = (finalCampaigns.length * campaignLineHeight) + 
        ((finalCampaigns.length - 1) * (lineSpacing - campaignLineHeight));
      currentY += dateHeaderHeight + dateHeaderSpacing + campaignsHeight + inchesToPixels(0.05);
      
      // Check for festive banner and campaign message (only if finishing all campaigns)
      const isFinishingDate = (currentCampaignIndex + campaignsThatFit >= campaigns.length);
      if (isFinishingDate) {
        // Draw festive banner
        const bannerSpaceStart = currentY;
        const bannerSpaceEnd = currentY + inchesToPixels(0.2);
        const bannerHeight = drawFestiveBanner(ctx, date, bannerSpaceStart, bannerSpaceEnd, SLIDE_WIDTH);
        currentY += bannerHeight;
        
        // Fetch and draw campaign message if exists
        const campaignMessage = await fetchMessageForDate(date);
        if (campaignMessage) {
          const messageSpaceStart = currentY + inchesToPixels(0.05);
          const messageSpaceEnd = messageSpaceStart + inchesToPixels(0.3);
          const messageHeight = drawMessageBanner(ctx, campaignMessage, messageSpaceStart, messageSpaceEnd, SLIDE_WIDTH);
          currentY += inchesToPixels(0.05) + messageHeight;
        }
        
        // Draw separator after week 1 (Sunday)
        if (i === 6 && week === 1) {
          const separatorText = '*'.repeat(50);
          ctx.font = `bold ${FONT_SIZES.colorKey}px Arial`;
          ctx.fillStyle = 'rgb(255, 0, 0)';
          ctx.textAlign = 'center';
          const separatorY = currentY + inchesToPixels(0.05);
          ctx.fillText(separatorText, SLIDE_WIDTH / 2, separatorY);
          currentY += inchesToPixels(0.4);
        }
      }
      
      if (willContinue) {
        const nextCampIndex = currentCampaignIndex + campaignsThatFit;
        return { canvas, nextDateIndex: i, nextCampaignIndex: nextCampIndex };
      }
      
      previousWeek = week;
      currentCampaignIndex = 0;
    }
    
    return { canvas, nextDateIndex: null, nextCampaignIndex: 0 };
  };

  const generateSlides = async () => {
    setIsGenerating(true);
    setError(null);
    setProgress('Starting slide generation...');

    try {
      const slides: Blob[] = [];
      let slideNumber = 1;
      let startDateIndex = 0;
      let startCampaignIndex = 0;
      
      while (slideNumber <= 20) {
        setProgress(`Generating slide ${slideNumber}...`);
        
        const result = await renderSlide(startDateIndex, startCampaignIndex);
        
        // Convert canvas to blob
        const blob = await new Promise<Blob>((resolve, reject) => {
          result.canvas.toBlob((b) => {
            if (b) resolve(b);
            else reject(new Error('Failed to create blob'));
          }, 'image/jpeg', 0.95);
        });
        
        slides.push(blob);
        
        if (result.nextDateIndex === null) {
          break;
        }
        
        startDateIndex = result.nextDateIndex;
        startCampaignIndex = result.nextCampaignIndex;
        slideNumber++;
      }
      
      if (slides.length === 0) {
        setError('No slides were generated. Please check if there are any campaigns in the database.');
        return;
      }
      
      setProgress(`Creating ZIP file with ${slides.length} slide(s)...`);
      
      // Create ZIP file
      const zip = new JSZip();
      for (let index = 0; index < slides.length; index++) {
        const blob = slides[index];
        // Convert blob to ArrayBuffer for proper ZIP handling
        const arrayBuffer = await blob.arrayBuffer();
        zip.file(`slide_${index + 1}.jpg`, arrayBuffer);
      }
      
      const zipBlob = await zip.generateAsync({ type: 'blob' });
      
      // Download ZIP
      const url = URL.createObjectURL(zipBlob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'campaign_slides.zip';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      
      setProgress(`Successfully generated ${slides.length} slide(s)!`);
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Failed to generate slides'));
    } finally {
      setIsGenerating(false);
    }
  };

  if (isUserLoading) {
    return (
      <MobileLayout>
        <div className="flex min-h-screen items-center justify-center">
          <div className="text-gray-600 dark:text-gray-400">Loading...</div>
        </div>
      </MobileLayout>
    );
  }

  if (!hasAccess) {
    return (
      <MobileLayout>
        <div className="p-4">
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-800 dark:bg-red-900/20">
            <h2 className="text-lg font-semibold text-red-800 dark:text-red-200">
              Access Denied
            </h2>
            <p className="mt-1 text-sm text-red-600 dark:text-red-300">
              {error || 'You do not have permission to access this page.'}
            </p>
            <button
              onClick={() => router.push(adminStatus === 'SR' ? '/app' : '/admin')}
              className="mt-4 rounded-md bg-red-600 px-4 py-2 text-base font-bold text-white hover:bg-red-700 border-2 border-gray-800 dark:border-gray-600"
            >
              Go Back
            </button>
          </div>
        </div>
      </MobileLayout>
    );
  }

  return (
    <MobileLayout>
      <div className="p-4">
        <div className="mb-6">
          <button
            onClick={() => router.push(adminStatus === 'SR' ? '/app' : '/admin')}
            className="mb-4 text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400"
          >
            ← {adminStatus === 'SR' ? 'Back to Home' : 'Back to Admin Panel'}
          </button>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            Generate Campaign Slides
          </h1>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            Generate JPEG slides for upcoming campaigns in the standard format
          </p>
        </div>

        {error && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-800 dark:bg-red-900/20">
            <p className="text-sm text-red-600 dark:text-red-300">{error}</p>
          </div>
        )}

        {progress && !error && (
          <div className="mb-4 rounded-lg border border-blue-200 bg-blue-50 p-4 dark:border-blue-800 dark:bg-blue-900/20">
            <p className="text-sm text-blue-800 dark:text-blue-200">{progress}</p>
          </div>
        )}

        <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
          <h2 className="mb-4 text-lg font-semibold text-gray-900 dark:text-gray-100">
            Generate Slides
          </h2>
          
          <div className="space-y-4">
            <div className="rounded-md bg-blue-50 p-3 dark:bg-blue-900/20">
              <p className="text-sm text-blue-800 dark:text-blue-200">
                This will generate slides for the upcoming two-week campaign period, starting from{' '}
                {(customStartDate ? new Date(customStartDate) : calculateStartDate()).toLocaleDateString('en-AU', { 
                  weekday: 'long', 
                  year: 'numeric', 
                  month: 'long', 
                  day: 'numeric' 
                })}.
              </p>
              <p className="mt-2 text-sm text-blue-800 dark:text-blue-200">
                Slides will be generated in portrait format (7.5&quot; × 10&quot;) at 300 DPI and downloaded as a ZIP file.
              </p>
            </div>
            
            <div>
              <label htmlFor="startDate" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Start Date (optional)
              </label>
              <input
                id="startDate"
                type="date"
                value={customStartDate}
                onChange={(e) => setCustomStartDate(e.target.value)}
                className="w-full rounded-md border-2 border-gray-400 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500 dark:border-gray-500 dark:bg-gray-900 dark:text-white"
              />
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                Leave empty to use the default &quot;Upcoming Campaign Start&quot; date
              </p>
            </div>
            
            <button
              onClick={generateSlides}
              disabled={isGenerating}
              className="w-full rounded-md bg-blue-600 px-4 py-2 text-base font-bold text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:bg-gray-400 disabled:cursor-not-allowed border-2 border-gray-800 dark:border-gray-600"
            >
              {isGenerating ? 'Generating Slides...' : 'Generate Campaign Slides'}
            </button>
          </div>
        </div>
      </div>
    </MobileLayout>
  );
}
