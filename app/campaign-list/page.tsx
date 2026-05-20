'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import MobileLayout from '@/components/MobileLayout';
import { useUser } from '@/contexts/UserContext';
import { supabase } from '@/lib/supabaseClient';
import {
  STATE_CODES,
  getSlideStateColor,
  formatSlideDateText,
  formatSlideTime,
} from '@/lib/slideLayout';

interface Campaign {
  id: string;
  date: string;
  state: string;
  place: string;
  time: string;
  leader: string;
  mobile: string | null;
  botj: boolean | string | number | null;
  category: string | null;
  tl_ok: boolean;
  sr_ok: boolean;
  source?: string | null;
}

interface DateBlock {
  date: Date;
  campaigns: Campaign[];
  message: string | null;
}

/** Format date as YYYY-MM-DD in local time (avoids UTC day-shift). */
function toLocalDateString(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Return the Monday of the week containing the given date. */
function startOfWeek(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay(); // 0 = Sun
  const diff = day === 0 ? -6 : 1 - day; // adjust to Monday
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Return the Sunday of the week containing the given date. */
function endOfWeek(date: Date): Date {
  const start = startOfWeek(date);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  end.setHours(23, 59, 59, 999);
  return end;
}

/** Format campaign for display with aligned columns (place, time, leader, mobile). */
function formatCampaignColumns(campaign: Campaign): { place: string; time: string; leader: string; mobile: string } {
  let place = campaign.place;
  // Append category code for all non-TWOL campaigns
  const cat = campaign.category ?? 'TWOL';
  if (cat !== 'TWOL') place = `${place} ${cat}`;
  if (place.length > 13) place = place.substring(0, 13);

  const time = formatSlideTime(campaign.time);
  const leader = campaign.leader;
  const mobile = (campaign.mobile ?? '').replace(/\s/g, '');
  return {
    place: place.padEnd(13, ' '),
    time: time.padStart(9, ' '),
    leader: leader.padEnd(8, ' '),
    mobile: mobile.padEnd(12, ' '),
  };
}

export default function CampaignListPage() {
  const router = useRouter();
  const { user, isAdmin, isLoading: isUserLoading } = useUser();
  const [hasAccess, setHasAccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dateBlocks, setDateBlocks] = useState<DateBlock[]>([]);
  const [isLoadingData, setIsLoadingData] = useState(false);

  // Week navigation — start on the Monday of the current week
  const [weekStart, setWeekStart] = useState<Date>(() => startOfWeek(new Date()));

  const weekEnd = endOfWeek(weekStart);

  useEffect(() => {
    if (isUserLoading) return;
    if (!user) { router.push('/login'); return; }
    setHasAccess(true);
  }, [isUserLoading, user, router]);

  const loadWeek = useCallback(async (start: Date) => {
    const end = endOfWeek(start);
    setIsLoadingData(true);
    setError(null);

    try {
      const startStr = toLocalDateString(start);
      const endStr = toLocalDateString(end);

      // Single query for all campaigns in the week
      const { data: allCampaigns, error: fetchError } = await supabase
        .from('campaigns')
        .select('*')
        .gte('date', startStr)
        .lte('date', endStr)
        .order('date', { ascending: true })
        .order('state', { ascending: true })
        .order('place', { ascending: true })
        .order('time', { ascending: true });

      if (fetchError) {
        setError(fetchError.message);
        return;
      }

      const campaigns = allCampaigns ?? [];
      const uniqueDates = [...new Set(campaigns.map((c) => c.date))].sort();

      // Batch-load all messages for the week in one query
      const { data: messageRows } = uniqueDates.length > 0
        ? await supabase
            .from('campaign_messages')
            .select('date, message')
            .in('date', uniqueDates)
        : { data: [] };

      const messageMap = new Map<string, string>();
      for (const row of messageRows ?? []) {
        messageMap.set(row.date, row.message);
      }

      const blocks: DateBlock[] = uniqueDates.map((dateStr) => {
        const [y, m, d] = dateStr.split('-').map(Number);
        return {
          date: new Date(y, m - 1, d),
          campaigns: campaigns.filter((c) => c.date === dateStr),
          message: messageMap.get(dateStr) ?? null,
        };
      });

      setDateBlocks(blocks);
    } finally {
      setIsLoadingData(false);
    }
  }, []);

  useEffect(() => {
    if (!hasAccess) return;
    loadWeek(weekStart);
  }, [hasAccess, weekStart, loadWeek]);

  const goToPrevWeek = () => {
    setWeekStart((prev) => {
      const d = new Date(prev);
      d.setDate(d.getDate() - 7);
      return d;
    });
  };

  const goToNextWeek = () => {
    setWeekStart((prev) => {
      const d = new Date(prev);
      d.setDate(d.getDate() + 7);
      return d;
    });
  };

  const goToCurrentWeek = () => {
    setWeekStart(startOfWeek(new Date()));
  };

  const isCurrentWeek = toLocalDateString(weekStart) === toLocalDateString(startOfWeek(new Date()));

  const weekLabel = (() => {
    const s = weekStart;
    const e = weekEnd;
    const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' };
    const startLabel = s.toLocaleDateString('en-AU', opts);
    const endLabel = e.toLocaleDateString('en-AU', { ...opts, year: 'numeric' });
    return `${startLabel} – ${endLabel}`;
  })();

  if (isUserLoading) {
    return (
      <MobileLayout>
        <div className="flex min-h-screen items-center justify-center">
          <span className="text-gray-600 dark:text-gray-400">Loading...</span>
        </div>
      </MobileLayout>
    );
  }

  if (!hasAccess) {
    return null;
  }

  if (error) {
    return (
      <MobileLayout>
        <div className="p-4">
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-800 dark:bg-red-900/20">
            <p className="text-sm text-red-600 dark:text-red-300">{error}</p>
            <Link
              href="/app"
              className="mt-4 inline-block rounded-md bg-red-600 px-4 py-2 text-base font-bold text-white hover:bg-red-700"
            >
              Back to Campaigns
            </Link>
          </div>
        </div>
      </MobileLayout>
    );
  }

  return (
    <MobileLayout>
      <div className="p-4 pb-8">
        <Link
          href="/app"
          className="mb-4 inline-block text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400"
        >
          ← Back to Campaigns
        </Link>

        {/* Week navigation */}
        <div className="mb-4 flex items-center justify-between gap-2">
          <button
            onClick={goToPrevWeek}
            disabled={isLoadingData}
            className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-bold text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600"
          >
            ← Prev
          </button>
          <div className="flex flex-col items-center">
            <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">{weekLabel}</span>
            {!isCurrentWeek && (
              <button
                onClick={goToCurrentWeek}
                className="mt-1 text-xs text-blue-600 hover:underline dark:text-blue-400"
              >
                Back to current week
              </button>
            )}
          </div>
          <button
            onClick={goToNextWeek}
            disabled={isLoadingData}
            className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-bold text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600"
          >
            Next →
          </button>
        </div>

        {/* Slide-style content */}
        <div className="mx-auto w-full max-w-2xl overflow-hidden rounded-lg border-2 border-gray-800 bg-white shadow dark:border-gray-600 dark:bg-gray-900 lg:max-w-5xl xl:max-w-6xl 2xl:max-w-7xl">
          {/* Red banner */}
          <div
            className="flex items-center justify-center py-3 text-center font-bold text-white"
            style={{ backgroundColor: 'rgb(255, 0, 0)' }}
          >
            <span className="text-xl sm:text-2xl">CURRENT A.F.J CAMPAIGNS</span>
          </div>

          {/* Colour key */}
          <div className="border-b border-gray-300 bg-white px-4 py-2 dark:border-gray-600 dark:bg-gray-900 lg:px-6">
            <p className="text-center text-sm font-bold sm:text-base">
              <span className="text-[rgb(130,0,0)]">Colour Key: </span>
              {STATE_CODES.map((state, i) => (
                <span key={state}>
                  <span style={{ color: getSlideStateColor(state) }}>{state}</span>
                  {i < STATE_CODES.length - 1 && <span className="text-black">   </span>}
                </span>
              ))}
            </p>
          </div>

          {/* Date blocks */}
          <div className="space-y-4 py-4 pl-2 pr-3 lg:px-6">
            {isLoadingData ? (
              <div className="p-6 text-center text-gray-600 dark:text-gray-400">
                Loading campaigns…
              </div>
            ) : dateBlocks.length === 0 || dateBlocks.every((b) => b.campaigns.length === 0) ? (
              <div className="p-6 text-center text-gray-500 dark:text-gray-400">
                No campaigns this week.
              </div>
            ) : (
              dateBlocks.map((block) => {
                if (block.campaigns.length === 0) return null;
                return (
                  <div key={block.date.toISOString()}>
                    {/* Yellow date header */}
                    <div className="mb-2 inline-block rounded px-2 py-1" style={{ backgroundColor: 'rgb(255, 255, 0)' }}>
                      <span className="text-sm font-semibold italic text-[rgb(130,0,0)] sm:text-base">
                        {formatSlideDateText(block.date)}
                      </span>
                    </div>

                    {/* Campaign lines */}
                    <div
                      className="font-mono text-sm sm:text-base lg:text-xl"
                      style={{ fontFamily: '"Courier New", monospace' }}
                    >
                      {block.campaigns.map((campaign) => {
                        const cols = formatCampaignColumns(campaign);
                        const showSource = isAdmin && campaign.source;
                        return (
                          <div
                            key={campaign.id}
                            className={`grid leading-relaxed gap-x-1 font-bold sm:gap-x-2 ${
                              showSource
                                ? 'grid-cols-[13ch_10ch_8ch_12ch_5ch] lg:grid-cols-[2fr_1fr_1fr_2fr_5ch]'
                                : 'grid-cols-[13ch_10ch_8ch_12ch] lg:grid-cols-[2fr_1fr_1fr_2fr]'
                            } lg:gap-x-6`}
                            style={{ color: getSlideStateColor(campaign.state) }}
                          >
                            <span className="min-w-0 truncate" title={cols.place.trim()}>
                              {cols.place}
                            </span>
                            <span className="text-right">{cols.time}</span>
                            <span className="min-w-0 truncate" title={cols.leader.trim()}>
                              {cols.leader}
                            </span>
                            <span>{cols.mobile}</span>
                            {showSource && (
                              <span
                                className="text-xs opacity-75"
                                title={
                                  campaign.source === 'MAN'
                                    ? 'Manual'
                                    : campaign.source === 'CFP'
                                      ? 'Copied from past week'
                                      : campaign.source === 'RUL'
                                        ? 'Created by rule'
                                        : campaign.source ?? ''
                                }
                              >
                                {campaign.source}
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>

                    {/* Festive banner */}
                    {block.date.getMonth() === 11 && block.date.getDate() === 31 && (
                      <div
                        className="mt-2 rounded px-3 py-2 text-center text-sm font-bold italic text-black"
                        style={{ backgroundColor: 'rgb(255, 165, 0)' }}
                      >
                        Happy New Year!
                      </div>
                    )}

                    {/* Campaign message banner */}
                    {block.message && (
                      <div
                        className="mt-2 rounded px-3 py-2 text-center text-sm font-bold italic text-black"
                        style={{ backgroundColor: 'rgb(255, 165, 0)' }}
                      >
                        {block.message}
                      </div>
                    )}

                    {/* Week separator after Sunday */}
                    {block.date.getDay() === 0 && (
                      <p className="mt-3 text-center font-bold text-red-600 dark:text-red-500">
                        {'*'.repeat(50)}
                      </p>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </MobileLayout>
  );
}
