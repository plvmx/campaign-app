'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import MobileLayout from '@/components/MobileLayout';
import LoadingSpinner from '@/components/LoadingSpinner';
import { useUser } from '@/contexts/UserContext';
import { supabase } from '@/lib/supabaseClient';
import { useCampaignDates } from '@/contexts/CampaignDatesContext';
import { formatDateForDb } from '@/lib/campaignDates';
import { getErrorMessage } from '@/lib/errorUtils';
import { getStateColor } from '@/lib/stateColors';
import { combinePlaceAndSite } from '@/lib/placeSite';

type ViewMode = 'total' | 'state' | 'place' | 'campaign';

interface CampaignRow {
  id: string;
  date: string;
  state: string;
  place: string;
  leader: string;
  actual_leader: string | null;
  memberNames: string[];
}

interface StateRow {
  state: string;
  campaigns: number;
  members: number;
}

interface PlaceRow {
  state: string;
  place: string;
  campaigns: number;
  members: number;
}

export default function MemberActivityPage() {
  const router = useRouter();
  const { user, isAdmin, isLoading: isUserLoading } = useUser();
  const { dates: campaignDates } = useCampaignDates();

  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [view, setView] = useState<ViewMode>('total');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasData, setHasData] = useState(false);

  // Computed views
  const [totalMembers, setTotalMembers] = useState(0);
  const [totalCampaigns, setTotalCampaigns] = useState(0);
  const [byState, setByState] = useState<StateRow[]>([]);
  const [byPlace, setByPlace] = useState<PlaceRow[]>([]);
  const [byCampaign, setByCampaign] = useState<CampaignRow[]>([]);

  useEffect(() => {
    if (isUserLoading) return;
    if (!user) { router.push('/login'); return; }
    if (!isAdmin) { router.push('/admin'); return; }
  }, [isUserLoading, user, isAdmin, router]);

  useEffect(() => {
    if (campaignDates && !startDate && !endDate) {
      const monday = campaignDates.pastCampaignStart;
      const sunday = new Date(monday);
      sunday.setDate(sunday.getDate() + 6);
      setStartDate(formatDateForDb(monday));
      setEndDate(formatDateForDb(sunday));
    }
  }, [campaignDates, startDate, endDate]);

  const fetchData = async () => {
    if (!startDate || !endDate) {
      setError('Please select both start and end dates');
      return;
    }
    setIsLoading(true);
    setError(null);
    setHasData(false);

    try {
      const { data: campaigns, error: campaignsError } = await supabase
        .from('campaigns')
        .select('id, date, state, place, site, leader, actual_leader')
        .gte('date', startDate)
        .lte('date', endDate)
        .order('date', { ascending: true })
        .order('state', { ascending: true })
        .order('place', { ascending: true });

      if (campaignsError) throw campaignsError;
      if (!campaigns || campaigns.length === 0) {
        setError('No campaigns found in the selected date range');
        setHasData(false);
        return;
      }

      const campaignIds = campaigns.map((c) => c.id);
      const { data: results, error: resultsError } = await supabase
        .from('results')
        .select('campaign_id, first_name')
        .in('campaign_id', campaignIds)
        .eq('category_code', 'TM');

      if (resultsError) throw resultsError;

      // Group TM names by campaign
      const tmByCampaign = new Map<string, string[]>();
      for (const r of results || []) {
        if (!tmByCampaign.has(r.campaign_id)) tmByCampaign.set(r.campaign_id, []);
        tmByCampaign.get(r.campaign_id)!.push(r.first_name);
      }

      // Build per-campaign rows (only campaigns with any member data)
      const campaignRows: CampaignRow[] = campaigns.map((c) => ({
        id: c.id,
        date: c.date,
        state: c.state,
        place: combinePlaceAndSite(c.place, c.site),
        leader: c.leader,
        actual_leader: c.actual_leader,
        memberNames: tmByCampaign.get(c.id) || [],
      }));

      // Active members = 1 (leader) + TM count
      const membersFor = (row: CampaignRow) => 1 + row.memberNames.length;

      // Totals
      const allMembers = campaignRows.reduce((sum, r) => sum + membersFor(r), 0);
      setTotalMembers(allMembers);
      setTotalCampaigns(campaignRows.length);

      // By state
      const stateMap = new Map<string, { campaigns: number; members: number }>();
      for (const r of campaignRows) {
        const s = stateMap.get(r.state) ?? { campaigns: 0, members: 0 };
        s.campaigns += 1;
        s.members += membersFor(r);
        stateMap.set(r.state, s);
      }
      setByState(
        Array.from(stateMap.entries())
          .map(([state, v]) => ({ state, ...v }))
          .sort((a, b) => b.members - a.members),
      );

      // By place
      const placeMap = new Map<string, { state: string; campaigns: number; members: number }>();
      for (const r of campaignRows) {
        const key = `${r.state}||${r.place}`;
        const p = placeMap.get(key) ?? { state: r.state, campaigns: 0, members: 0 };
        p.campaigns += 1;
        p.members += membersFor(r);
        placeMap.set(key, p);
      }
      setByPlace(
        Array.from(placeMap.entries())
          .map(([key, v]) => ({ place: key.split('||')[1], ...v }))
          .sort((a, b) => b.members - a.members),
      );

      setByCampaign(campaignRows);
      setHasData(true);
    } catch (err) {
      setError(getErrorMessage(err, 'Error loading member activity'));
    } finally {
      setIsLoading(false);
    }
  };

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' });
  };

  const tabs: { key: ViewMode; label: string }[] = [
    { key: 'total', label: 'Total' },
    { key: 'state', label: 'By State' },
    { key: 'place', label: 'By Place' },
    { key: 'campaign', label: 'By Campaign' },
  ];

  if (isUserLoading) {
    return (
      <MobileLayout>
        <div className="flex min-h-screen items-center justify-center">
          <LoadingSpinner />
        </div>
      </MobileLayout>
    );
  }

  return (
    <MobileLayout>
      <div className="p-4 pb-28">
        <div className="mb-6">
          <a
            href="/admin"
            className="mb-4 inline-block text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400"
          >
            ← Back to Admin Panel
          </a>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            Member Activity
          </h1>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            Active members (leader + team) across campaigns in a date range
          </p>
        </div>

        {error && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-800 dark:bg-red-900/20">
            <p className="text-sm text-red-600 dark:text-red-300">{error}</p>
          </div>
        )}

        {/* Date range + fetch */}
        <div className="mb-6 rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
          <h2 className="mb-4 text-lg font-semibold text-gray-900 dark:text-gray-100">Date Range</h2>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Start Date</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">End Date</label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
              />
            </div>
            <button
              type="button"
              onClick={fetchData}
              disabled={isLoading}
              className="w-full rounded-md bg-blue-600 px-4 py-2 text-base font-bold text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:bg-gray-400 disabled:cursor-not-allowed border-2 border-gray-800 dark:border-gray-600"
            >
              {isLoading ? 'Loading…' : 'Load Data'}
            </button>
          </div>
        </div>

        {hasData && (
          <>
            {/* View tabs */}
            <div className="mb-4 flex gap-2 flex-wrap">
              {tabs.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setView(t.key)}
                  className={`rounded-md px-4 py-2 text-sm font-semibold border-2 transition-colors ${
                    view === t.key
                      ? 'bg-blue-600 text-white border-blue-700'
                      : 'bg-white text-gray-700 border-gray-400 hover:bg-gray-50 dark:bg-gray-800 dark:text-gray-200 dark:border-gray-600 dark:hover:bg-gray-700'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {/* Total view */}
            {view === 'total' && (
              <div className="space-y-4">
                <div className="rounded-lg border-2 border-blue-300 bg-blue-50 p-6 text-center dark:border-blue-700 dark:bg-blue-900/30">
                  <p className="text-5xl font-bold text-blue-700 dark:text-blue-300">{totalMembers}</p>
                  <p className="mt-2 text-base font-semibold text-blue-900 dark:text-blue-100">Total Active Members</p>
                  <p className="mt-1 text-sm text-blue-700 dark:text-blue-300">across {totalCampaigns} campaign{totalCampaigns !== 1 ? 's' : ''}</p>
                </div>
                <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    <span className="font-semibold">Average per campaign:</span>{' '}
                    {totalCampaigns > 0 ? (totalMembers / totalCampaigns).toFixed(1) : '—'}
                  </p>
                </div>
              </div>
            )}

            {/* By State view */}
            {view === 'state' && (
              <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 dark:bg-gray-700">
                    <tr>
                      <th className="px-4 py-3 text-left font-semibold text-gray-700 dark:text-gray-200">State</th>
                      <th className="px-4 py-3 text-right font-semibold text-gray-700 dark:text-gray-200">Campaigns</th>
                      <th className="px-4 py-3 text-right font-semibold text-gray-700 dark:text-gray-200">Members</th>
                      <th className="px-4 py-3 text-right font-semibold text-gray-700 dark:text-gray-200">Avg / Campaign</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                    {byState.map((row) => {
                      const stateColor = getStateColor(row.state);
                      return (
                        <tr key={row.state} className={`${stateColor.bg}`}>
                          <td className="px-4 py-3 font-semibold text-gray-900 dark:text-gray-100">{row.state}</td>
                          <td className="px-4 py-3 text-right text-gray-700 dark:text-gray-300">{row.campaigns}</td>
                          <td className="px-4 py-3 text-right font-bold text-gray-900 dark:text-gray-100">{row.members}</td>
                          <td className="px-4 py-3 text-right text-gray-700 dark:text-gray-300">{(row.members / row.campaigns).toFixed(1)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot className="bg-gray-100 dark:bg-gray-600">
                    <tr>
                      <td className="px-4 py-3 font-bold text-gray-900 dark:text-gray-100">Total</td>
                      <td className="px-4 py-3 text-right font-bold text-gray-900 dark:text-gray-100">{totalCampaigns}</td>
                      <td className="px-4 py-3 text-right font-bold text-gray-900 dark:text-gray-100">{totalMembers}</td>
                      <td className="px-4 py-3 text-right font-bold text-gray-900 dark:text-gray-100">
                        {totalCampaigns > 0 ? (totalMembers / totalCampaigns).toFixed(1) : '—'}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}

            {/* By Place view */}
            {view === 'place' && (
              <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 dark:bg-gray-700">
                    <tr>
                      <th className="px-4 py-3 text-left font-semibold text-gray-700 dark:text-gray-200">Place</th>
                      <th className="px-4 py-3 text-left font-semibold text-gray-700 dark:text-gray-200">State</th>
                      <th className="px-4 py-3 text-right font-semibold text-gray-700 dark:text-gray-200">Campaigns</th>
                      <th className="px-4 py-3 text-right font-semibold text-gray-700 dark:text-gray-200">Members</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                    {byPlace.map((row) => {
                      const stateColor = getStateColor(row.state);
                      return (
                        <tr key={`${row.state}-${row.place}`} className={`${stateColor.bg}`}>
                          <td className="px-4 py-3 font-medium text-gray-900 dark:text-gray-100">{row.place}</td>
                          <td className="px-4 py-3 text-gray-700 dark:text-gray-300">{row.state}</td>
                          <td className="px-4 py-3 text-right text-gray-700 dark:text-gray-300">{row.campaigns}</td>
                          <td className="px-4 py-3 text-right font-bold text-gray-900 dark:text-gray-100">{row.members}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot className="bg-gray-100 dark:bg-gray-600">
                    <tr>
                      <td colSpan={2} className="px-4 py-3 font-bold text-gray-900 dark:text-gray-100">Total</td>
                      <td className="px-4 py-3 text-right font-bold text-gray-900 dark:text-gray-100">{totalCampaigns}</td>
                      <td className="px-4 py-3 text-right font-bold text-gray-900 dark:text-gray-100">{totalMembers}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}

            {/* By Campaign view */}
            {view === 'campaign' && (
              <div className="space-y-3">
                {byCampaign.map((row) => {
                  const stateColor = getStateColor(row.state);
                  const memberCount = 1 + row.memberNames.length;
                  const displayLeader = row.actual_leader || row.leader;
                  return (
                    <div
                      key={row.id}
                      className={`rounded-lg border border-gray-200 dark:border-gray-700 p-4 ${stateColor.bg}`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-gray-900 dark:text-gray-100">
                            {row.place}, {row.state}
                          </p>
                          <p className="text-sm text-gray-600 dark:text-gray-400">{formatDate(row.date)}</p>
                          <p className="text-sm text-gray-700 dark:text-gray-300 mt-1">
                            Leader: <span className="font-medium">{displayLeader}</span>
                          </p>
                          {row.memberNames.length > 0 && (
                            <p className="text-sm text-gray-700 dark:text-gray-300 mt-0.5">
                              Team: {row.memberNames.join(', ')}
                            </p>
                          )}
                        </div>
                        <div className="flex-shrink-0 text-right">
                          <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">{memberCount}</p>
                          <p className="text-xs text-gray-500 dark:text-gray-400">member{memberCount !== 1 ? 's' : ''}</p>
                        </div>
                      </div>
                    </div>
                  );
                })}
                <div className="rounded-lg border-2 border-gray-400 bg-gray-100 dark:border-gray-600 dark:bg-gray-700 px-4 py-3 flex justify-between items-center">
                  <span className="font-bold text-gray-900 dark:text-gray-100">Total</span>
                  <span className="text-xl font-bold text-gray-900 dark:text-gray-100">{totalMembers} members</span>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </MobileLayout>
  );
}
