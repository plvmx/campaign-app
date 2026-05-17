'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import MobileLayout from '@/components/MobileLayout';
import { useUser } from '@/contexts/UserContext';
import { supabase } from '@/lib/supabaseClient';
import { calculateCampaignDates, formatDateForDb as formatDateForDbLib } from '@/lib/campaignDates';
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
  tl_ok: boolean;
  sr_ok: boolean;
  source?: string | null;
}

interface DateBlock {
  date: Date;
  campaigns: Campaign[];
  message: string | null;
}

/** Format campaign for display with aligned columns (place, time, leader, mobile). */
function formatCampaignColumns(campaign: Campaign): { place: string; time: string; leader: string; mobile: string } {
  let place = campaign.place;
  const bofj = campaign.botj;
  let appendBOTJ = false;
  if (typeof bofj === 'boolean') appendBOTJ = bofj;
  else if (typeof bofj === 'number') appendBOTJ = bofj === 1;
  else if (typeof bofj === 'string')
    appendBOTJ = bofj === '1' || bofj.toLowerCase() === 'yes' || bofj.toLowerCase() === 'true';
  if (appendBOTJ) place = `${place} BOTJ`;
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

  useEffect(() => {
    if (isUserLoading) return;
    if (!user) { router.push('/login'); return; }
    setHasAccess(true);
  }, [isUserLoading, user, router]);

  useEffect(() => {
    if (!hasAccess) return;

    let cancelled = false;

    async function loadData() {
      setIsLoadingData(true);
      setError(null);

      try {
        const dates = calculateCampaignDates();
        const startDateStr = formatDateForDbLib(dates.pastCampaignStart);

        const { data: allCampaigns, error: fetchError } = await supabase
          .from('campaigns')
          .select('*')
          .gte('date', startDateStr)
          .order('date', { ascending: true })
          .order('state', { ascending: true })
          .order('place', { ascending: true })
          .order('time', { ascending: true });

        if (cancelled) return;
        if (fetchError) {
          setError(fetchError.message);
          return;
        }

        const campaigns = allCampaigns ?? [];
        const uniqueDates = [...new Set(campaigns.map((c) => c.date))].sort();

        const blocks: DateBlock[] = [];
        for (const dateStr of uniqueDates) {
          const [y, m, d] = dateStr.split('-').map(Number);
          const date = new Date(y, m - 1, d);
          const dateCampaigns = campaigns.filter((c) => c.date === dateStr);

          const { data: msgRow } = await supabase
            .from('campaign_messages')
            .select('message')
            .eq('date', dateStr)
            .single();

          blocks.push({
            date,
            campaigns: dateCampaigns,
            message: msgRow?.message ?? null,
          });
        }

        setDateBlocks(blocks);
      } finally {
        if (!cancelled) setIsLoadingData(false);
      }
    }

    loadData();
    return () => {
      cancelled = true;
    };
  }, [hasAccess]);

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

        {/* Slide-style content: same layout as JPEG slides, scrollable; desktop: wider box and larger text */}
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

          {/* Date blocks and campaigns: minimal left padding on mobile (one space from border); more padding on desktop */}
          <div className="space-y-4 py-4 pl-2 pr-3 lg:px-6">
            {dateBlocks.map((block) => {
              if (block.campaigns.length === 0) return null;

              return (
                <div key={block.date.toISOString()}>
                  {/* Yellow date header */}
                  <div className="mb-2 inline-block rounded px-2 py-1" style={{ backgroundColor: 'rgb(255, 255, 0)' }}>
                    <span className="text-sm font-semibold italic text-[rgb(130,0,0)] sm:text-base">
                      {formatSlideDateText(block.date)}
                    </span>
                  </div>

                  {/* Campaign lines: fixed columns on mobile; spread to fill width on desktop, larger text on desktop */}
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

                  {/* Festive banner (e.g. Happy New Year on Dec 31) */}
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

                  {/* Week separator after each Sunday */}
                  {block.date.getDay() === 0 && (
                    <p className="mt-3 text-center font-bold text-red-600 dark:text-red-500">
                      {'*'.repeat(50)}
                    </p>
                  )}
                </div>
              );
            })}
          </div>

          {isLoadingData && dateBlocks.length === 0 && (
            <div className="p-6 text-center text-gray-600 dark:text-gray-400">
              Loading campaigns… You&apos;ll see the records soon.
            </div>
          )}
          {!isLoadingData && dateBlocks.every((b) => b.campaigns.length === 0) && (
            <div className="p-6 text-center text-gray-500 dark:text-gray-400">
              No campaigns in the current date range.
            </div>
          )}
        </div>
      </div>
    </MobileLayout>
  );
}
