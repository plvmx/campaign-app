'use client';

import { useEffect, useState, useRef, useCallback, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import MobileLayout from '@/components/MobileLayout';
import { supabase } from '@/lib/supabaseClient';
import { fetchCampaignData } from '@/lib/campaignLog';
import { normalizeMobile, normalizeName } from '@/lib/auth';
import { getSharedWithMeOwners } from '@/lib/leaderShares';
import { useUser } from '@/contexts/UserContext';
import { updateCampaign, createCampaign } from '@/lib/services/campaignService';

interface InputRow {
  id: string;
  field1: string;
  field2: string;
  field3: string;
}

type SectionType = 'partial' | 'full' | 'fullSinners' | 'information';

function RecordResultsDetailPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const {
    user: contextUser,
    isAdmin: contextIsAdmin,
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
  const [partialRows, setPartialRows] = useState<InputRow[]>([]);
  const [fullRows, setFullRows] = useState<InputRow[]>([]);
  const [fullSinnersRows, setFullSinnersRows] = useState<InputRow[]>([]);
  const [informationRows, setInformationRows] = useState<InputRow[]>([]);
  const [campaignId, setCampaignId] = useState<string | null>(null);
  const [teamSize, setTeamSize] = useState<string>('');
  const [ppCnt, setPpCnt] = useState<string>('');
  const [fpCnt, setFpCnt] = useState<string>('');
  const [fpspCnt, setFpspCnt] = useState<string>('');
  const [irCnt, setIrCnt] = useState<string>('');
  const [pendingSaves, setPendingSaves] = useState<Map<string, { section: SectionType; name: string; categoryCode: 'P' | 'F' | 'SP' | 'IR' }>>(new Map());
  const [originalNames, setOriginalNames] = useState<Set<string>>(new Set());
  
  // Use refs to access latest values in cleanup functions
  const pendingSavesRef = useRef(pendingSaves);
  const campaignIdRef = useRef(campaignId);
  const originalNamesRef = useRef(originalNames);
  const partialRowsRef = useRef(partialRows);
  const fullRowsRef = useRef(fullRows);
  const fullSinnersRowsRef = useRef(fullSinnersRows);
  const informationRowsRef = useRef(informationRows);
  const debounceNamesTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savingNamesRef = useRef(false);
  // Keep user ID available in cleanup/async callbacks that run after unmount
  const userIdRef = useRef<string | null>(null);
  
  // Keep refs in sync with state
  useEffect(() => {
    pendingSavesRef.current = pendingSaves;
  }, [pendingSaves]);
  
  useEffect(() => {
    campaignIdRef.current = campaignId;
  }, [campaignId]);
  
  useEffect(() => {
    originalNamesRef.current = originalNames;
  }, [originalNames]);
  
  useEffect(() => {
    partialRowsRef.current = partialRows;
  }, [partialRows]);
  
  useEffect(() => {
    fullRowsRef.current = fullRows;
  }, [fullRows]);
  
  useEffect(() => {
    fullSinnersRowsRef.current = fullSinnersRows;
  }, [fullSinnersRows]);
  
  useEffect(() => {
    informationRowsRef.current = informationRows;
  }, [informationRows]);

  useEffect(() => {
    userIdRef.current = contextUser?.id ?? null;
  }, [contextUser]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (isUserLoading) return;
    if (!contextUser) {
      router.push('/login');
      return;
    }

    const generateId = () =>
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    const emptyRow = (): InputRow => ({ id: generateId(), field1: '', field2: '', field3: '' });

    const createRowsFromNames = (names: string[]): InputRow[] => {
      const rows: InputRow[] = [];
      for (let i = 0; i < names.length; i += 3) {
        rows.push({ id: generateId(), field1: names[i] || '', field2: names[i + 1] || '', field3: names[i + 2] || '' });
      }
      if (rows.length === 0) rows.push(emptyRow());
      return rows;
    };

    async function init() {
      try {
        const date = searchParams.get('date') || '';
        const state = searchParams.get('state') || '';
        const place = searchParams.get('place') || '';
        const time = searchParams.get('time') || '';
        const leader = searchParams.get('leader') || '';
        const filter = searchParams.get('returnFilter') || 'future';

        setCampaignData({ date, state, place, time, leader });
        setReturnFilter(filter);

        const cid = await findOrCreateCampaign(contextUser!.id, { date, state, place, time, leader });
        setCampaignId(cid);

        const [campaignResponse, resultsResponse] = await Promise.all([
          supabase.from('campaigns').select('team_size, pp_cnt, fp_cnt, fpsp_cnt, ir_cnt').eq('id', cid).single(),
          supabase.from('results').select('first_name, category_code, created_at').eq('campaign_id', cid).order('created_at', { ascending: true }),
        ]);

        if (!campaignResponse.error && campaignResponse.data) {
          const d = campaignResponse.data;
          setTeamSize(d.team_size?.toString() || '');
          setPpCnt(d.pp_cnt?.toString() || '');
          setFpCnt(d.fp_cnt?.toString() || '');
          setFpspCnt(d.fpsp_cnt?.toString() || '');
          setIrCnt(d.ir_cnt?.toString() || '');
        }

        if (!resultsResponse.error && resultsResponse.data) {
          const existing = resultsResponse.data;
          setOriginalNames(new Set(existing.map((r) => `${r.first_name}:${r.category_code}`)));
          setPartialRows(createRowsFromNames(existing.filter((r) => r.category_code === 'P').map((r) => r.first_name)));
          setFullRows(createRowsFromNames(existing.filter((r) => r.category_code === 'F').map((r) => r.first_name)));
          setFullSinnersRows(createRowsFromNames(existing.filter((r) => r.category_code === 'SP').map((r) => r.first_name)));
          setInformationRows(createRowsFromNames(existing.filter((r) => r.category_code === 'IR').map((r) => r.first_name)));
        } else {
          setPartialRows([emptyRow()]);
          setFullRows([emptyRow()]);
          setFullSinnersRows([emptyRow()]);
          setInformationRows([emptyRow()]);
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        const isAuthError = msg.toLowerCase().includes('auth') || msg.toLowerCase().includes('session') || msg.toLowerCase().includes('jwt');
        if (isAuthError) router.push('/login');
        else console.error('Record results init error:', error);
      } finally {
        setIsLoading(false);
      }
    }
    init();
  }, [isUserLoading, contextUser]);

  // Find an existing campaign or create one if the user is the owner.
  const findOrCreateCampaign = useCallback(async (
    userId: string,
    campaignParams: { date: string; state: string; place: string; time: string; leader: string }
  ): Promise<string> => {
    const userMobileAndLeader = contextUserMobile && contextUserLeader
      ? { mobile: contextUserMobile, leader: contextUserLeader }
      : null;

    const { data: campaigns } = await supabase
      .from('campaigns')
      .select('id, mobile, state, leader')
      .eq('date', campaignParams.date)
      .eq('state', campaignParams.state)
      .eq('place', campaignParams.place)
      .eq('time', campaignParams.time)
      .eq('leader', campaignParams.leader);

    let existingCampaign: { id: string } | null = null;
    if (contextIsAdmin) {
      existingCampaign = campaigns && campaigns.length > 0 ? campaigns[0] : null;
    } else if (campaigns && campaigns.length > 0) {
      // Own: mobile match
      if (userMobileAndLeader?.mobile) {
        const normalizedMobile = normalizeMobile(userMobileAndLeader.mobile);
        existingCampaign = campaigns.find((c: { mobile: string | null }) =>
          c.mobile && normalizeMobile(c.mobile) === normalizedMobile
        ) || null;
      }
      // Shared: campaign's (state, leader) is shared with me
      if (!existingCampaign && contextUserState && userMobileAndLeader?.leader) {
        const sharedOwners = await getSharedWithMeOwners(contextUserState, userMobileAndLeader.leader);
        const isShared = sharedOwners.some(
          (o) =>
            (o.owner_state || '').toUpperCase().trim() === (campaignParams.state || '').toUpperCase().trim() &&
            normalizeName(o.owner_leader) === normalizeName(campaignParams.leader || '')
        );
        if (isShared) existingCampaign = campaigns[0];
      }
      if (!existingCampaign && campaigns.length > 0 && !userMobileAndLeader?.mobile) {
        existingCampaign = campaigns[0];
      }
    }

    if (existingCampaign) return existingCampaign.id;

    const isOwner = userMobileAndLeader?.leader &&
      normalizeName(campaignParams.leader || '') === normalizeName(userMobileAndLeader.leader);
    if (!contextIsAdmin && !isOwner) {
      throw new Error('You can only create campaigns for your own leader. This campaign is not shared with you or does not exist.');
    }

    const created = await createCampaign({
      date: campaignParams.date,
      state: campaignParams.state,
      place: campaignParams.place,
      time: campaignParams.time,
      leader: campaignParams.leader,
      mobile: userMobileAndLeader?.mobile || null,
      botj: 'No',
      user_id: userId,
    });

    return created.id;
  }, [contextIsAdmin, contextUserState, contextUserLeader, contextUserMobile]);

  // Function to get category code from section type
  const getCategoryCode = (section: SectionType): 'P' | 'F' | 'SP' | 'IR' => {
    switch (section) {
      case 'partial':
        return 'P';
      case 'full':
        return 'F';
      case 'fullSinners':
        return 'SP';
      case 'information':
        return 'IR';
    }
  };

  // Function to cache a name for later saving
  const cacheNameForSave = (
    section: SectionType,
    rowId: string,
    fieldName: 'field1' | 'field2' | 'field3',
    name: string
  ) => {
    if (!campaignId) {
      return; // Don't cache if campaign doesn't exist
    }

    const cacheKey = `${section}-${rowId}-${fieldName}`;
    const categoryCode = getCategoryCode(section);

    setPendingSaves((prev) => {
      const newMap = new Map(prev);
      if (name.trim()) {
        // Add or update the cached name
        newMap.set(cacheKey, {
          section,
          name: name.trim(),
          categoryCode,
        });
      } else {
        // Remove from cache if name is empty
        newMap.delete(cacheKey);
      }
      return newMap;
    });
  };

  const saveTeamSize = async () => {
    if (!campaignId) return;
    try {
      const oldData = await fetchCampaignData(campaignId);
      await updateCampaign(campaignId, { team_size: teamSize.trim() ? parseInt(teamSize, 10) : null }, oldData);
    } catch (error) {
      console.error('Error saving team size:', error);
    }
  };

  const saveCountFields = async () => {
    if (!campaignId) return;
    try {
      const oldData = await fetchCampaignData(campaignId);
      await updateCampaign(campaignId, {
        pp_cnt: ppCnt.trim() ? parseInt(ppCnt, 10) : 0,
        fp_cnt: fpCnt.trim() ? parseInt(fpCnt, 10) : 0,
        fpsp_cnt: fpspCnt.trim() ? parseInt(fpspCnt, 10) : 0,
        ir_cnt: irCnt.trim() ? parseInt(irCnt, 10) : 0,
      }, oldData);
    } catch (error) {
      console.error('Error saving count fields:', error);
    }
  };

  // Function to save all pending names to the database.
  // Guarded to prevent concurrent runs (which could persist intermediate typing states like "M", "Muh").
  const savePendingNames = useCallback(async () => {
    if (savingNamesRef.current) return;
    const currentCampaignId = campaignIdRef.current;
    if (!currentCampaignId) return;

    savingNamesRef.current = true;
    try {
      const userId = userIdRef.current;
      if (!userId) throw new Error('User not authenticated');

      const currentOriginalNames = originalNamesRef.current;

      // Build the set of current names from the live row refs
      const currentNames = new Set<string>();
      const addNamesFromRows = (rows: InputRow[], categoryCode: string) => {
        rows.forEach((row) => {
          [row.field1, row.field2, row.field3].forEach((v) => {
            const name = v.trim();
            if (name) currentNames.add(`${name}:${categoryCode}`);
          });
        });
      };
      addNamesFromRows(partialRowsRef.current, 'P');
      addNamesFromRows(fullRowsRef.current, 'F');
      addNamesFromRows(fullSinnersRowsRef.current, 'SP');
      addNamesFromRows(informationRowsRef.current, 'IR');

      // Delete names that were removed
      const namesToDelete: { name: string; categoryCode: string }[] = [];
      currentOriginalNames.forEach((nameKey) => {
        if (!currentNames.has(nameKey)) {
          const lastColon = nameKey.lastIndexOf(':');
          namesToDelete.push({ name: nameKey.slice(0, lastColon), categoryCode: nameKey.slice(lastColon + 1) });
        }
      });
      for (const { name, categoryCode } of namesToDelete) {
        const { error: deleteError } = await supabase
          .from('results')
          .delete()
          .eq('campaign_id', currentCampaignId)
          .eq('first_name', name)
          .eq('category_code', categoryCode);
        if (deleteError) console.error('Error deleting name:', name, categoryCode, deleteError);
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

      if (resultsToSave.length > 0) {
        const { error } = await supabase.from('results').upsert(resultsToSave, {
          onConflict: 'campaign_id,first_name,category_code',
        });
        if (error) console.error('Error saving names:', error);
      }

      setOriginalNames(currentNames);
      originalNamesRef.current = currentNames;
      setPendingSaves(new Map());
      pendingSavesRef.current = new Map();
    } catch (error: unknown) {
      console.error('Error saving names:', error);
    } finally {
      savingNamesRef.current = false;
    }
  }, []);

  // Debounce name saves so we only persist after the user stops typing (prevents "M", "Muh", "Muhammad" as separate records).
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

  // Auto-save periodically and on navigation
  useEffect(() => {
    // Save team size and counts every 3 seconds; names are saved only via debounce or flush (see scheduleSaveNames / flushSaveNames)
    const autoSaveInterval = setInterval(() => {
      const currentCampaignId = campaignIdRef.current;
      if (currentCampaignId) {
        saveTeamSize();
        saveCountFields();
      }
    }, 3000);

    const handleBeforeUnload = () => {
      const currentCampaignId = campaignIdRef.current;
      if (currentCampaignId) {
        flushSaveNames();
        saveTeamSize();
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
      const currentCampaignId = campaignIdRef.current;
      if (currentCampaignId) {
        saveTeamSize();
        saveCountFields();
        flushSaveNames();
      }
    };
  }, [flushSaveNames]);

  const addNewRow = (section: SectionType) => {
    // Generate a unique ID using crypto.randomUUID if available, otherwise use timestamp
    const generateId = () => {
      if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        return crypto.randomUUID();
      }
      return `${section}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    };
    
    const newRow: InputRow = {
      id: generateId(),
      field1: '',
      field2: '',
      field3: '',
    };
    
    // Use functional state updates to avoid stale closure issues
    switch (section) {
      case 'partial':
        setPartialRows((prevRows) => [...prevRows, newRow]);
        break;
      case 'full':
        setFullRows((prevRows) => [...prevRows, newRow]);
        break;
      case 'fullSinners':
        setFullSinnersRows((prevRows) => [...prevRows, newRow]);
        break;
      case 'information':
        setInformationRows((prevRows) => [...prevRows, newRow]);
        break;
    }
  };

  const updateRowField = (
    section: SectionType,
    rowId: string,
    fieldName: 'field1' | 'field2' | 'field3',
    value: string
  ) => {
    // Use functional state updates to avoid stale closure issues
    switch (section) {
      case 'partial':
        setPartialRows((prevRows) =>
          prevRows.map((row) =>
            row.id === rowId ? { ...row, [fieldName]: value } : row
          )
        );
        break;
      case 'full':
        setFullRows((prevRows) =>
          prevRows.map((row) =>
            row.id === rowId ? { ...row, [fieldName]: value } : row
          )
        );
        break;
      case 'fullSinners':
        setFullSinnersRows((prevRows) =>
          prevRows.map((row) =>
            row.id === rowId ? { ...row, [fieldName]: value } : row
          )
        );
        break;
      case 'information':
        setInformationRows((prevRows) =>
          prevRows.map((row) =>
            row.id === rowId ? { ...row, [fieldName]: value } : row
          )
        );
        break;
    }
  };

  const handleNameChange = (
    section: SectionType,
    rowId: string,
    fieldName: 'field1' | 'field2' | 'field3',
    value: string
  ) => {
    // Update the local state
    updateRowField(section, rowId, fieldName, value);
    // Cache the name for later saving
    cacheNameForSave(section, rowId, fieldName, value);
    // Debounce save so we only persist after user stops typing (avoids saving "M", "Muh", "Muhammad" as separate records)
    scheduleSaveNames();
  };

  const renderInputGrid = (rows: InputRow[], section: SectionType) => {
    return (
      <div className="space-y-2">
        {rows.map((row, index) => (
          <div key={row.id} className="flex gap-2 w-full">
            <input
              type="text"
              value={row.field1}
              onChange={(e) => handleNameChange(section, row.id, 'field1', e.target.value)}
              maxLength={255}
              className="flex-1 min-w-0 rounded-md border-2 border-gray-400 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500 dark:border-gray-500 dark:bg-gray-900 dark:text-white"
              placeholder="Name 1"
            />
            <input
              type="text"
              value={row.field2}
              onChange={(e) => handleNameChange(section, row.id, 'field2', e.target.value)}
              maxLength={255}
              className="flex-1 min-w-0 rounded-md border-2 border-gray-400 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500 dark:border-gray-500 dark:bg-gray-900 dark:text-white"
              placeholder="Name 2"
            />
            <input
              type="text"
              value={row.field3}
              onChange={(e) => handleNameChange(section, row.id, 'field3', e.target.value)}
              maxLength={255}
              className="flex-1 min-w-0 rounded-md border-2 border-gray-400 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500 dark:border-gray-500 dark:bg-gray-900 dark:text-white"
              placeholder="Name 3"
            />
            {index === rows.length - 1 && (
              <button
                onClick={() => addNewRow(section)}
                className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-md border-2 border-gray-400 bg-white text-lg font-semibold text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-500 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600"
                aria-label="Add new row"
              >
                +
              </button>
            )}
          </div>
        ))}
      </div>
    );
  };

  if (isUserLoading || isLoading) {
    return (
      <MobileLayout>
        <div className="flex min-h-screen items-center justify-center">
          <div className="text-gray-600 dark:text-gray-400">Loading...</div>
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
                  // Format date
                  const dateObj = new Date(campaignData.date + 'T00:00:00');
                  const formattedDate = dateObj.toLocaleDateString('en-US', {
                    weekday: 'short',
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric',
                  });
                  
                  // Format time
                  const timeStr = campaignData.time.includes('T')
                    ? campaignData.time.split('T')[1]?.split('.')[0]
                    : campaignData.time;
                  const [hours, minutes] = timeStr.split(':');
                  const hour = parseInt(hours, 10);
                  const ampm = hour >= 12 ? 'PM' : 'AM';
                  const displayHour = hour % 12 || 12;
                  const formattedTime = `${displayHour}:${minutes} ${ampm}`;
                  
                  return `${formattedDate} at ${formattedTime}`;
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
              <p className="text-sm font-semibold text-blue-900 dark:text-blue-100 mb-1">
                Changes are automatically saved
              </p>
              <p className="text-xs text-blue-800 dark:text-blue-200">
                All your entries are saved automatically every few seconds. There is no need to click a Save button.
              </p>
            </div>
          </div>
        </div>

        {/* Team Size Input */}
        <div className="mb-6">
          <label htmlFor="teamSize" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            Number of people in my team
          </label>
          <input
            id="teamSize"
            type="number"
            min="0"
            value={teamSize}
            onChange={(e) => setTeamSize(e.target.value)}
            onBlur={saveTeamSize}
            className="block w-full rounded-md border-2 border-gray-400 bg-white px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500 dark:border-gray-500 dark:bg-gray-900 dark:text-white"
            placeholder="Enter number of team members"
          />
        </div>

        {/* Partial Presentations Banner - count field hidden */}
        <div className="mb-4 rounded-md bg-green-100 px-4 py-2 dark:bg-green-900/30">
          <span className="text-sm font-medium text-green-800 dark:text-green-200">
            Partial Presentations
          </span>
        </div>

        {/* Partial Presentations Input Fields */}
        {renderInputGrid(partialRows, 'partial')}

        {/* Full Presentations Banner - count field hidden */}
        <div className="mb-4 mt-6 rounded-md bg-orange-100 px-4 py-2 dark:bg-orange-900/30">
          <span className="text-sm font-medium text-orange-800 dark:text-orange-200">
            Full Presentations Only
          </span>
        </div>

        {/* Full Presentations Input Fields */}
        {renderInputGrid(fullRows, 'full')}

        {/* Full Presentations and Sinners Prayers Banner - count field hidden */}
        <div className="mb-4 mt-6 rounded-md bg-red-100 px-4 py-2 dark:bg-red-900/30">
          <span className="text-sm font-medium text-red-800 dark:text-red-200">
            Full Presentations and Sinners Prayers
          </span>
        </div>

        {/* Full Presentations and Sinners Prayers Input Fields */}
        {renderInputGrid(fullSinnersRows, 'fullSinners')}

        {/* Information Requests Banner - count field hidden */}
        <div className="mb-4 mt-6 rounded-md bg-yellow-100 px-4 py-2 dark:bg-yellow-900/30">
          <span className="text-sm font-medium text-yellow-800 dark:text-yellow-200">
            Information Requests
          </span>
        </div>

        {/* Information Requests Input Fields */}
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
          <div className="text-gray-600 dark:text-gray-400">Loading...</div>
        </div>
      </MobileLayout>
    }>
      <RecordResultsDetailPageContent />
    </Suspense>
  );
}

