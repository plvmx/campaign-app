'use client';

import { useEffect, useState, useRef, useCallback, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import MobileLayout from '@/components/MobileLayout';
import LoadingSpinner from '@/components/LoadingSpinner';
import { fetchCampaignData } from '@/lib/campaignLog';
import { normalizeMobile, normalizeName } from '@/lib/auth';
import { getSharedWithMeOwners } from '@/lib/leaderShares';
import { useUser } from '@/contexts/UserContext';
import { updateCampaign, createCampaign, getCampaignById, findCampaignsByKey } from '@/lib/services/campaignService';
import { getResultsByCampaignId, upsertResults, deleteResult } from '@/lib/services/resultsService';
import { trackEvent } from '@/lib/analytics';

interface InputRow {
  id: string;
  field1: string;
  field2: string;
  field3: string;
}

type SectionType = 'members' | 'partial' | 'full' | 'fullSinners' | 'information';

interface SavedCounts { pp: number; fp: number; fpsp: number; ir: number }

const generateId = () =>
  typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

const countNames = (rows: InputRow[]) =>
  rows.flatMap((r) => [r.field1, r.field2, r.field3]).filter((v) => v.trim()).length;

function RecordResultsDetailPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const {
    user: contextUser,
    isAdmin: contextIsAdmin,
    adminStatus: contextAdminStatus,
    userState: contextUserState,
    userLeader: contextUserLeader,
    userMobile: contextUserMobile,
    isLoading: isUserLoading,
  } = useUser();

  const [isLoading, setIsLoading] = useState(true);
  const [campaignData, setCampaignData] = useState({
    date: '',
    state: '',
    place: '',
    time: '',
    leader: '',
  });
  const [returnFilter, setReturnFilter] = useState<string>('future');
  const [membersRows, setMembersRows] = useState<InputRow[]>([]);
  const [partialRows, setPartialRows] = useState<InputRow[]>([]);
  const [fullRows, setFullRows] = useState<InputRow[]>([]);
  const [fullSinnersRows, setFullSinnersRows] = useState<InputRow[]>([]);
  const [informationRows, setInformationRows] = useState<InputRow[]>([]);
  const [campaignId, setCampaignId] = useState<string | null>(null);
  const [teamSize, setTeamSize] = useState<string>('');
  const [actualLeader, setActualLeader] = useState<string>('');
  const [ppCnt, setPpCnt] = useState<string>('');
  const [fpCnt, setFpCnt] = useState<string>('');
  const [fpspCnt, setFpspCnt] = useState<string>('');
  const [irCnt, setIrCnt] = useState<string>('');
  const [originalNames, setOriginalNames] = useState<Set<string>>(new Set());
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  // Refs for accessing latest values in interval/cleanup callbacks (avoids stale closures)
  const campaignIdRef = useRef(campaignId);
  const originalNamesRef = useRef(originalNames);
  const membersRowsRef = useRef(membersRows);
  const partialRowsRef = useRef(partialRows);
  const fullRowsRef = useRef(fullRows);
  const fullSinnersRowsRef = useRef(fullSinnersRows);
  const informationRowsRef = useRef(informationRows);
  const teamSizeRef = useRef(teamSize);
  const actualLeaderRef = useRef(actualLeader);
  const ppCntRef = useRef(ppCnt);
  const fpCntRef = useRef(fpCnt);
  const fpspCntRef = useRef(fpspCnt);
  const irCntRef = useRef(irCnt);

  // Last-saved values for change detection — undefined means not yet initialised
  const lastSavedTeamSizeRef = useRef<number | null | undefined>(undefined);
  const lastSavedActualLeaderRef = useRef<string | null | undefined>(undefined);
  const lastSavedCountsRef = useRef<SavedCounts | undefined>(undefined);

  const debounceNamesTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savingNamesRef = useRef(false);
  const hasTrackedSaveRef = useRef(false);
  const userIdRef = useRef<string | null>(null);
  const saveStatusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep refs in sync with state
  useEffect(() => { campaignIdRef.current = campaignId; }, [campaignId]);
  useEffect(() => { originalNamesRef.current = originalNames; }, [originalNames]);
  useEffect(() => { membersRowsRef.current = membersRows; }, [membersRows]);
  useEffect(() => { partialRowsRef.current = partialRows; }, [partialRows]);
  useEffect(() => { fullRowsRef.current = fullRows; }, [fullRows]);
  useEffect(() => { fullSinnersRowsRef.current = fullSinnersRows; }, [fullSinnersRows]);
  useEffect(() => { informationRowsRef.current = informationRows; }, [informationRows]);
  useEffect(() => { teamSizeRef.current = teamSize; }, [teamSize]);
  useEffect(() => { actualLeaderRef.current = actualLeader; }, [actualLeader]);
  useEffect(() => { ppCntRef.current = ppCnt; }, [ppCnt]);
  useEffect(() => { fpCntRef.current = fpCnt; }, [fpCnt]);
  useEffect(() => { fpspCntRef.current = fpspCnt; }, [fpspCnt]);
  useEffect(() => { irCntRef.current = irCnt; }, [irCnt]);
  useEffect(() => { userIdRef.current = contextUser?.id ?? null; }, [contextUser]);

  // Find an existing campaign or create one if the user is the owner.
  // When knownId is supplied (navigated from campaign list), skip the natural-key lookup
  // and do a single fetch by ID instead.
  const findOrCreateCampaign = useCallback(async (
    userId: string,
    campaignParams: { date: string; state: string; place: string; time: string; leader: string },
    knownId?: string,
  ): Promise<string> => {
    const userMobileAndLeader = contextUserMobile && contextUserLeader
      ? { mobile: contextUserMobile, leader: contextUserLeader }
      : null;

    const isSRForState = (state: string) =>
      contextAdminStatus === 'SR' &&
      (state || '').toUpperCase().trim() === (contextUserState || '').toUpperCase().trim();

    const checkShared = async (state: string, leader: string) => {
      if (!contextUserState || !userMobileAndLeader?.leader) return false;
      const sharedOwners = await getSharedWithMeOwners(contextUserState, userMobileAndLeader.leader);
      return sharedOwners.some(
        (o) =>
          (o.owner_state || '').toUpperCase().trim() === (state || '').toUpperCase().trim() &&
          normalizeName(o.owner_leader) === normalizeName(leader || ''),
      );
    };

    // Fast path: campaign ID already known — verify access and return directly.
    if (knownId) {
      const campaign = await getCampaignById(knownId);
      if (!campaign) throw new Error('Campaign not found.');
      if (contextIsAdmin || isSRForState(campaign.state)) return campaign.id;
      if (userMobileAndLeader?.mobile && campaign.mobile &&
          normalizeMobile(campaign.mobile) === normalizeMobile(userMobileAndLeader.mobile)) return campaign.id;
      if (await checkShared(campaign.state, campaign.leader)) return campaign.id;
      if (!userMobileAndLeader?.mobile) return campaign.id;
      throw new Error('You can only record results for your own campaigns. This campaign is not in your state or shared with you.');
    }

    // Slow path: look up by natural key.
    const campaigns = await findCampaignsByKey(campaignParams);

    let existingCampaign: { id: string } | null = null;
    if (contextIsAdmin || isSRForState(campaignParams.state)) {
      existingCampaign = campaigns.length > 0 ? campaigns[0] : null;
    } else if (campaigns.length > 0) {
      if (userMobileAndLeader?.mobile) {
        const normalizedMobile = normalizeMobile(userMobileAndLeader.mobile);
        existingCampaign = campaigns.find((c: { mobile: string | null }) =>
          c.mobile && normalizeMobile(c.mobile) === normalizedMobile,
        ) || null;
      }
      if (!existingCampaign && await checkShared(campaignParams.state, campaignParams.leader)) {
        existingCampaign = campaigns[0];
      }
      if (!existingCampaign && !userMobileAndLeader?.mobile) {
        existingCampaign = campaigns[0];
      }
    }

    if (existingCampaign) return existingCampaign.id;

    const isOwner = userMobileAndLeader?.leader &&
      normalizeName(campaignParams.leader || '') === normalizeName(userMobileAndLeader.leader);
    if (!contextIsAdmin && !isSRForState(campaignParams.state) && !isOwner) {
      throw new Error('You can only record results for your own campaigns. This campaign is not in your state or shared with you.');
    }

    const created = await createCampaign({
      date: campaignParams.date,
      state: campaignParams.state,
      place: campaignParams.place,
      time: campaignParams.time,
      leader: campaignParams.leader,
      mobile: userMobileAndLeader?.mobile || null,
      category: 'TWOL',
      user_id: userId,
    });

    return created.id;
  }, [contextIsAdmin, contextAdminStatus, contextUserState, contextUserLeader, contextUserMobile]);

  useEffect(() => {
    if (isUserLoading) return;
    if (!contextUser) {
      router.push('/login');
      return;
    }

    let cancelled = false;

    const emptyRow = (): InputRow => ({ id: generateId(), field1: '', field2: '', field3: '' });

    const createRowsFromNames = (names: string[]): InputRow[] => {
      const rows: InputRow[] = [];
      for (let i = 0; i < names.length; i += 3) {
        rows.push({ id: generateId(), field1: names[i] || '', field2: names[i + 1] || '', field3: names[i + 2] || '' });
      }
      if (rows.length === 0) rows.push(emptyRow());
      return rows;
    };

    setIsLoading(true);
    setCampaignId(null);

    async function init() {
      try {
        const idParam = searchParams.get('id') || undefined;
        const date = searchParams.get('date') || '';
        const state = searchParams.get('state') || '';
        const place = searchParams.get('place') || '';
        const time = searchParams.get('time') || '';
        const leader = searchParams.get('leader') || '';
        const filter = searchParams.get('returnFilter') || 'future';

        if (cancelled) return;
        setCampaignData({ date, state, place, time, leader });
        setReturnFilter(filter);

        const cid = await findOrCreateCampaign(contextUser!.id, { date, state, place, time, leader }, idParam);
        if (cancelled) return;
        setCampaignId(cid);

        const [campaignResponse, existing] = await Promise.all([
          getCampaignById(cid),
          getResultsByCampaignId(cid),
        ]);

        if (cancelled) return;

        if (campaignResponse) {
          const d = campaignResponse;
          const ts = d.team_size?.toString() || '';
          const pp = d.pp_cnt?.toString() || '';
          const fp = d.fp_cnt?.toString() || '';
          const fpsp = d.fpsp_cnt?.toString() || '';
          const ir = d.ir_cnt?.toString() || '';
          setTeamSize(ts);
          setActualLeader(d.actual_leader ?? leader);
          setPpCnt(pp);
          setFpCnt(fp);
          setFpspCnt(fpsp);
          setIrCnt(ir);
          // Initialise last-saved refs so the interval skips saves when unchanged
          lastSavedTeamSizeRef.current = d.team_size ?? null;
          lastSavedActualLeaderRef.current = d.actual_leader ?? null;
          lastSavedCountsRef.current = {
            pp: d.pp_cnt ?? 0,
            fp: d.fp_cnt ?? 0,
            fpsp: d.fpsp_cnt ?? 0,
            ir: d.ir_cnt ?? 0,
          };
        } else {
          setActualLeader(leader);
          lastSavedActualLeaderRef.current = null;
        }

        setOriginalNames(new Set(existing.map((r) => `${r.first_name}:${r.category_code}`)));
        setMembersRows(createRowsFromNames(existing.filter((r) => r.category_code === 'TM').map((r) => r.first_name)));
        setPartialRows(createRowsFromNames(existing.filter((r) => r.category_code === 'P').map((r) => r.first_name)));
        setFullRows(createRowsFromNames(existing.filter((r) => r.category_code === 'F').map((r) => r.first_name)));
        setFullSinnersRows(createRowsFromNames(existing.filter((r) => r.category_code === 'SP').map((r) => r.first_name)));
        setInformationRows(createRowsFromNames(existing.filter((r) => r.category_code === 'IR').map((r) => r.first_name)));
        if (existing.length === 0) {
          setMembersRows([emptyRow()]);
          setPartialRows([emptyRow()]);
          setFullRows([emptyRow()]);
          setFullSinnersRows([emptyRow()]);
          setInformationRows([emptyRow()]);
        }
      } catch (error) {
        if (cancelled) return;
        const msg = error instanceof Error ? error.message : String(error);
        const isAuthError = msg.toLowerCase().includes('auth') || msg.toLowerCase().includes('session') || msg.toLowerCase().includes('jwt');
        if (isAuthError) router.push('/login');
        else console.error('Record results init error:', error);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }
    init();

    return () => { cancelled = true; };
  }, [isUserLoading, contextUser, searchParams, findOrCreateCampaign, router]);

  // Save team size only when the value has changed since last save.
  // Reads from refs so the 3-second interval always sees the current value.
  const saveTeamSize = async () => {
    const cid = campaignIdRef.current;
    if (!cid) return;
    const parsed = teamSizeRef.current.trim() ? parseInt(teamSizeRef.current, 10) : null;
    if (lastSavedTeamSizeRef.current !== undefined && parsed === lastSavedTeamSizeRef.current) return;
    try {
      const oldData = await fetchCampaignData(cid);
      await updateCampaign(cid, { team_size: parsed }, oldData);
      lastSavedTeamSizeRef.current = parsed;
    } catch (error) {
      console.error('Error saving team size:', error);
      setSaveStatus('error');
    }
  };

  const saveActualLeader = async () => {
    const cid = campaignIdRef.current;
    if (!cid) return;
    const value = actualLeaderRef.current.trim() || null;
    if (lastSavedActualLeaderRef.current !== undefined && value === lastSavedActualLeaderRef.current) return;
    try {
      const oldData = await fetchCampaignData(cid);
      await updateCampaign(cid, { actual_leader: value }, oldData);
      lastSavedActualLeaderRef.current = value;
    } catch (error) {
      console.error('Error saving actual leader:', error);
      setSaveStatus('error');
    }
  };

  // Save count fields only when any value has changed since last save.
  const saveCountFields = async () => {
    const cid = campaignIdRef.current;
    if (!cid) return;
    const current: SavedCounts = {
      pp: ppCntRef.current.trim() ? parseInt(ppCntRef.current, 10) : 0,
      fp: fpCntRef.current.trim() ? parseInt(fpCntRef.current, 10) : 0,
      fpsp: fpspCntRef.current.trim() ? parseInt(fpspCntRef.current, 10) : 0,
      ir: irCntRef.current.trim() ? parseInt(irCntRef.current, 10) : 0,
    };
    const last = lastSavedCountsRef.current;
    if (last !== undefined &&
        current.pp === last.pp && current.fp === last.fp &&
        current.fpsp === last.fpsp && current.ir === last.ir) return;
    try {
      const oldData = await fetchCampaignData(cid);
      await updateCampaign(cid, { pp_cnt: current.pp, fp_cnt: current.fp, fpsp_cnt: current.fpsp, ir_cnt: current.ir }, oldData);
      lastSavedCountsRef.current = current;
    } catch (error) {
      console.error('Error saving count fields:', error);
      setSaveStatus('error');
    }
  };

  // Save all pending names. Guarded against concurrent runs (prevents saving "M", "Muh" mid-type).
  const savePendingNames = useCallback(async () => {
    if (savingNamesRef.current) return;
    const currentCampaignId = campaignIdRef.current;
    if (!currentCampaignId) return;

    savingNamesRef.current = true;
    setSaveStatus('saving');
    try {
      const userId = userIdRef.current;
      if (!userId) throw new Error('User not authenticated');

      const currentOriginalNames = originalNamesRef.current;

      // Build the full set of current names from live row refs
      const currentNames = new Set<string>();
      const addNamesFromRows = (rows: InputRow[], categoryCode: string) => {
        rows.forEach((row) => {
          [row.field1, row.field2, row.field3].forEach((v) => {
            const name = v.trim();
            if (name) currentNames.add(`${name}:${categoryCode}`);
          });
        });
      };
      addNamesFromRows(membersRowsRef.current, 'TM');
      addNamesFromRows(partialRowsRef.current, 'P');
      addNamesFromRows(fullRowsRef.current, 'F');
      addNamesFromRows(fullSinnersRowsRef.current, 'SP');
      addNamesFromRows(informationRowsRef.current, 'IR');

      // Delete names that were removed
      for (const nameKey of currentOriginalNames) {
        if (!currentNames.has(nameKey)) {
          const lastColon = nameKey.lastIndexOf(':');
          const name = nameKey.slice(0, lastColon);
          const categoryCode = nameKey.slice(lastColon + 1);
          try {
            await deleteResult(currentCampaignId, name, categoryCode);
          } catch (err) {
            console.error('Error deleting name:', name, categoryCode, err);
          }
        }
      }

      // Upsert current names
      const resultsToSave = Array.from(currentNames).map((nameKey) => {
        const lastColon = nameKey.lastIndexOf(':');
        return {
          campaign_id: currentCampaignId,
          first_name: nameKey.slice(0, lastColon),
          category_code: nameKey.slice(lastColon + 1),
          user_id: userId,
        };
      });
      await upsertResults(resultsToSave);

      setOriginalNames(currentNames);
      originalNamesRef.current = currentNames;

      setSaveStatus('saved');
      if (saveStatusTimerRef.current) clearTimeout(saveStatusTimerRef.current);
      saveStatusTimerRef.current = setTimeout(() => setSaveStatus('idle'), 3000);

      if (!hasTrackedSaveRef.current) {
        hasTrackedSaveRef.current = true;
        trackEvent('record_results_save', {
          state:  campaignData.state  || undefined,
          leader: campaignData.leader || undefined,
        });
      }
    } catch (error: unknown) {
      console.error('Error saving names:', error);
      setSaveStatus('error');
    } finally {
      savingNamesRef.current = false;
    }
  }, [campaignData.state, campaignData.leader]);

  const DEBOUNCE_MS = 2000;
  const scheduleSaveNames = useCallback(() => {
    if (debounceNamesTimerRef.current) clearTimeout(debounceNamesTimerRef.current);
    debounceNamesTimerRef.current = setTimeout(() => {
      debounceNamesTimerRef.current = null;
      savePendingNames();
    }, DEBOUNCE_MS);
  }, [savePendingNames]);

  const flushSaveNames = useCallback(() => {
    if (debounceNamesTimerRef.current) {
      clearTimeout(debounceNamesTimerRef.current);
      debounceNamesTimerRef.current = null;
    }
    savePendingNames();
  }, [savePendingNames]);

  // Auto-save periodically and on navigation/unmount
  useEffect(() => {
    const autoSaveInterval = setInterval(() => {
      if (campaignIdRef.current) {
        saveTeamSize();
        saveActualLeader();
        saveCountFields();
      }
    }, 3000);

    const handleBeforeUnload = () => {
      if (campaignIdRef.current) {
        flushSaveNames();
        saveTeamSize();
        saveActualLeader();
        saveCountFields();
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      clearInterval(autoSaveInterval);
      window.removeEventListener('beforeunload', handleBeforeUnload);
      if (debounceNamesTimerRef.current) {
        clearTimeout(debounceNamesTimerRef.current);
        debounceNamesTimerRef.current = null;
      }
      if (saveStatusTimerRef.current) {
        clearTimeout(saveStatusTimerRef.current);
        saveStatusTimerRef.current = null;
      }
      if (campaignIdRef.current) {
        saveTeamSize();
        saveActualLeader();
        saveCountFields();
        flushSaveNames();
      }
    };
  }, [flushSaveNames]);

  const addNewRow = (section: SectionType) => {
    const newRow: InputRow = { id: generateId(), field1: '', field2: '', field3: '' };
    switch (section) {
      case 'members':    setMembersRows((prev) => [...prev, newRow]); break;
      case 'partial':    setPartialRows((prev) => [...prev, newRow]); break;
      case 'full':       setFullRows((prev) => [...prev, newRow]); break;
      case 'fullSinners': setFullSinnersRows((prev) => [...prev, newRow]); break;
      case 'information': setInformationRows((prev) => [...prev, newRow]); break;
    }
  };

  const updateRowField = (
    section: SectionType,
    rowId: string,
    fieldName: 'field1' | 'field2' | 'field3',
    value: string,
  ) => {
    const update = (prev: InputRow[]) => prev.map((row) => row.id === rowId ? { ...row, [fieldName]: value } : row);
    switch (section) {
      case 'members':    setMembersRows(update); break;
      case 'partial':    setPartialRows(update); break;
      case 'full':       setFullRows(update); break;
      case 'fullSinners': setFullSinnersRows(update); break;
      case 'information': setInformationRows(update); break;
    }
  };

  const handleNameChange = (
    section: SectionType,
    rowId: string,
    fieldName: 'field1' | 'field2' | 'field3',
    value: string,
  ) => {
    updateRowField(section, rowId, fieldName, value);
    if (campaignId) scheduleSaveNames();
  };

  const renderInputGrid = (rows: InputRow[], section: SectionType) => (
    <div className="space-y-2">
      {rows.map((row) => (
        <div key={row.id} className="flex gap-2 w-full">
          <input
            type="text"
            value={row.field1}
            onChange={(e) => handleNameChange(section, row.id, 'field1', e.target.value)}
            maxLength={255}
            className="flex-1 min-w-0 rounded-md border-2 border-gray-400 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500 dark:border-gray-500 dark:bg-gray-900 dark:text-white"
            placeholder="Enter first name"
          />
          <input
            type="text"
            value={row.field2}
            onChange={(e) => handleNameChange(section, row.id, 'field2', e.target.value)}
            maxLength={255}
            className="flex-1 min-w-0 rounded-md border-2 border-gray-400 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500 dark:border-gray-500 dark:bg-gray-900 dark:text-white"
            placeholder="Enter first name"
          />
          <input
            type="text"
            value={row.field3}
            onChange={(e) => handleNameChange(section, row.id, 'field3', e.target.value)}
            maxLength={255}
            className="flex-1 min-w-0 rounded-md border-2 border-gray-400 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500 dark:border-gray-500 dark:bg-gray-900 dark:text-white"
            placeholder="Enter first name"
          />
        </div>
      ))}
      <button
        onClick={() => addNewRow(section)}
        className="mt-1 flex items-center gap-2 rounded-md border-2 border-gray-400 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-500 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600"
      >
        <span className="text-lg leading-none">+</span>
        <span>Add more names</span>
      </button>
    </div>
  );

  if (isUserLoading || isLoading) {
    return (
      <MobileLayout>
        <div className="flex min-h-screen items-center justify-center">
          <LoadingSpinner text="Loading campaign results…" />
        </div>
      </MobileLayout>
    );
  }

  return (
    <MobileLayout>
      <div className="p-4 bg-blue-50 dark:bg-blue-900/20 min-h-screen">
        <div className="mb-6">
          <button
            onClick={() => router.push(`/app?filter=${returnFilter}`)}
            className="mb-4 text-base font-bold text-blue-600 hover:text-blue-700 dark:text-blue-400 hover:underline border-2 border-gray-800 dark:border-gray-600 rounded-md px-3 py-1"
          >
            ← Back to Campaigns
          </button>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            Record Results
          </h1>
          <div className="mt-2 space-y-1">
            <p className="text-base font-semibold text-gray-900 dark:text-gray-100">
              {campaignData.place}, {campaignData.state}
            </p>
            {campaignData.date && campaignData.time && (
              <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
                {(() => {
                  const dateObj = new Date(campaignData.date + 'T00:00:00');
                  const formattedDate = dateObj.toLocaleDateString('en-US', {
                    weekday: 'short',
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric',
                  });
                  const timeStr = campaignData.time.includes('T')
                    ? campaignData.time.split('T')[1]?.split('.')[0]
                    : campaignData.time;
                  const [hours, minutes] = timeStr.split(':');
                  const hour = parseInt(hours, 10);
                  const ampm = hour >= 12 ? 'PM' : 'AM';
                  const displayHour = hour % 12 || 12;
                  return `${formattedDate} at ${displayHour}:${minutes} ${ampm}`;
                })()}
              </p>
            )}
          </div>
        </div>

        {/* Campaign Report Notice */}
        <div className="mb-6 rounded-lg border-4 border-yellow-500 bg-yellow-100 px-4 py-4 shadow-lg dark:border-yellow-400 dark:bg-yellow-900/50">
          <div className="flex items-start gap-3">
            <div className="flex-shrink-0 mt-0.5">
              <svg className="h-6 w-6 text-yellow-700 dark:text-yellow-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-base font-bold text-yellow-900 dark:text-yellow-100 break-words">
                Please continue to use the existing Campaign Report to record your campaign numbers{' '}
                <a
                  href="https://www.australiaforjesus.org.au/campaignreport"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline hover:text-yellow-700 dark:hover:text-yellow-200"
                >
                  Click Here to Open It
                </a>
              </p>
            </div>
          </div>
        </div>

        {/* Auto-save notification */}
        <div className="mb-6 rounded-lg border-2 border-blue-400 bg-blue-100 px-4 py-3 shadow-sm dark:border-blue-500 dark:bg-blue-900/40">
          <div className="flex items-start gap-3">
            <div className="flex-shrink-0 mt-0.5">
              <svg className="h-5 w-5 text-blue-600 dark:text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div className="flex-1">
              <div className="flex items-center justify-between gap-2 mb-1">
                <p className="text-sm font-semibold text-blue-900 dark:text-blue-100">
                  Changes are automatically saved
                </p>
                {saveStatus === 'saving' && (
                  <span className="flex-shrink-0 text-xs font-medium text-blue-600 dark:text-blue-300 animate-pulse">
                    Saving…
                  </span>
                )}
                {saveStatus === 'saved' && (
                  <span className="flex-shrink-0 text-xs font-medium text-green-600 dark:text-green-400">
                    ✓ Saved
                  </span>
                )}
                {saveStatus === 'error' && (
                  <span className="flex-shrink-0 text-xs font-medium text-red-600 dark:text-red-400">
                    Save failed — check connection
                  </span>
                )}
              </div>
              <p className="text-xs text-blue-800 dark:text-blue-200">
                All your entries are saved automatically every few seconds. There is no need to click a Save button.
              </p>
            </div>
          </div>
        </div>

        {/* Actual Leader */}
        <div className="mb-4">
          <label htmlFor="actualLeader" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            Leader name (actual)
          </label>
          <input
            id="actualLeader"
            type="text"
            maxLength={255}
            value={actualLeader}
            onChange={(e) => setActualLeader(e.target.value)}
            onBlur={saveActualLeader}
            className="block w-full rounded-md border-2 border-gray-400 bg-white px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500 dark:border-gray-500 dark:bg-gray-900 dark:text-white"
            placeholder="Enter actual leader name"
          />
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            Pre-filled from the campaign. Update if a different person led on the day.
          </p>
        </div>

        {/* Team Members */}
        <div className="mb-2 rounded-md bg-purple-100 px-4 py-3 dark:bg-purple-900/30">
          <div className="flex items-center justify-between">
            <p className="text-base font-bold text-purple-800 dark:text-purple-200">Team Members</p>
            <span className="text-sm font-semibold text-purple-700 dark:text-purple-300">{countNames(membersRows)}</span>
          </div>
          <p className="mt-1 text-sm text-purple-700 dark:text-purple-300">
            Enter the first name of each person on your campaign team.
          </p>
        </div>
        {renderInputGrid(membersRows, 'members')}

        {/* Partial Presentations */}
        <div className="mb-2 mt-6 rounded-md bg-green-100 px-4 py-3 dark:bg-green-900/30">
          <div className="flex items-center justify-between">
            <p className="text-base font-bold text-green-800 dark:text-green-200">Partial Presentations</p>
            <span className="text-sm font-semibold text-green-700 dark:text-green-300">{countNames(partialRows)}</span>
          </div>
          <p className="mt-1 text-sm text-green-700 dark:text-green-300">
            Enter the first name of each person who received a partial presentation of the gospel.
          </p>
        </div>
        {renderInputGrid(partialRows, 'partial')}

        {/* Full Presentations Only */}
        <div className="mb-2 mt-6 rounded-md bg-orange-100 px-4 py-3 dark:bg-orange-900/30">
          <div className="flex items-center justify-between">
            <p className="text-base font-bold text-orange-800 dark:text-orange-200">Full Presentations Only</p>
            <span className="text-sm font-semibold text-orange-700 dark:text-orange-300">{countNames(fullRows)}</span>
          </div>
          <p className="mt-1 text-sm text-orange-700 dark:text-orange-300">
            Enter the first name of each person who received a full presentation of the gospel.
          </p>
        </div>
        {renderInputGrid(fullRows, 'full')}

        {/* Full Presentations and Sinners Prayers */}
        <div className="mb-2 mt-6 rounded-md bg-red-100 px-4 py-3 dark:bg-red-900/30">
          <div className="flex items-center justify-between">
            <p className="text-base font-bold text-red-800 dark:text-red-200">Full Presentations and Sinners Prayers</p>
            <span className="text-sm font-semibold text-red-700 dark:text-red-300">{countNames(fullSinnersRows)}</span>
          </div>
          <p className="mt-1 text-sm text-red-700 dark:text-red-300">
            Enter the first name of each person who received a full presentation and prayed a sinner&apos;s prayer.
          </p>
        </div>
        {renderInputGrid(fullSinnersRows, 'fullSinners')}

        {/* Information Requests */}
        <div className="mb-2 mt-6 rounded-md bg-yellow-100 px-4 py-3 dark:bg-yellow-900/30">
          <div className="flex items-center justify-between">
            <p className="text-base font-bold text-yellow-800 dark:text-yellow-200">Information Requests</p>
            <span className="text-sm font-semibold text-yellow-700 dark:text-yellow-300">{countNames(informationRows)}</span>
          </div>
          <p className="mt-1 text-sm text-yellow-700 dark:text-yellow-300">
            Enter the first name of each person who requested more information.
          </p>
        </div>
        {renderInputGrid(informationRows, 'information')}
      </div>
    </MobileLayout>
  );
}

export default function RecordResultsDetailPage() {
  return (
    <Suspense fallback={
      <MobileLayout>
        <div className="flex min-h-screen items-center justify-center">
          <LoadingSpinner />
        </div>
      </MobileLayout>
    }>
      <RecordResultsDetailPageContent />
    </Suspense>
  );
}
