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
import {
  getResultsByCampaignId,
  insertResults,
  updateResult,
  deleteResult,
  type ResultRow,
} from '@/lib/services/resultsService';
import { logResultsSave, type ResultsLogRow } from '@/lib/resultsLog';
import {
  saveDraft as saveResultsDraft,
  loadDraft as loadResultsDraft,
  clearDraft as clearResultsDraft,
  draftHasContent,
  type RecordResultsDraft,
  type NameSlotDraft,
  type ResultsCategory,
} from '@/lib/recordResultsDraft';
import { trackEvent } from '@/lib/analytics';
import { getErrorMessage } from '@/lib/errorUtils';

interface NameSlot {
  value: string;
  dbId: string | null;  // null = not yet inserted; set after first successful save
}

interface InputRow {
  id: string;                                 // stable React key for the row
  slots: [NameSlot, NameSlot, NameSlot];      // exactly 3 name slots per row (visual grouping)
}

type SectionType = 'members' | 'partial' | 'full' | 'fullSinners' | 'information';

const emptySlot = (): NameSlot => ({ value: '', dbId: null });

interface SavedCounts { pp: number; fp: number; fpsp: number; ir: number }

const generateId = () =>
  typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

const countNames = (rows: InputRow[]) =>
  rows.flatMap((r) => r.slots).filter((s) => s.value.trim()).length;

// Transient network errors (dropped connection, timeout, brief Supabase
// blips) are common on mobile and shouldn't surface as a save failure on the
// first attempt — retry a couple of times with backoff before giving up.
async function withRetry<T>(fn: () => Promise<T>, attempts = 3, baseDelayMs = 800): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (i < attempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, baseDelayMs * 2 ** i));
      }
    }
  }
  throw lastError;
}

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
  // What's currently on the server, keyed by row id. Drives the save diff.
  const [originalEntries, setOriginalEntries] = useState<Map<string, { first_name: string; category_code: ResultsCategory }>>(new Map());
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [draftRestoredAt, setDraftRestoredAt] = useState<string | null>(null);
  const [hasUnsavedDraft, setHasUnsavedDraft] = useState(false);

  // Refs for accessing latest values in interval/cleanup callbacks (avoids stale closures)
  const campaignIdRef = useRef(campaignId);
  const originalEntriesRef = useRef(originalEntries);
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
  const debounceActualLeaderTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rerunNamesRef = useRef(false);
  const savingNamesRef = useRef(false);
  const hasTrackedSaveRef = useRef(false);
  const userIdRef = useRef<string | null>(null);
  const saveStatusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep refs in sync with state
  useEffect(() => { campaignIdRef.current = campaignId; }, [campaignId]);
  useEffect(() => { originalEntriesRef.current = originalEntries; }, [originalEntries]);
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

  // Mirror the visible form state to localStorage on every change, so a tab
  // close, network drop, or RLS rejection mid-save can't silently lose the
  // user's typing. Skips during initial load (before campaignId is set).
  // The draft is cleared after a confirmed-successful save in savePendingNames.
  useEffect(() => {
    if (!campaignId || isLoading) return;
    // Persist every slot that either has content or carries a dbId. Trailing
    // empty-and-unsaved slots are dropped — they're meaningless on restore.
    const collect = (rows: InputRow[]): NameSlotDraft[] => {
      const all: NameSlotDraft[] = rows.flatMap((r) => r.slots).map((s) => ({
        value: s.value,
        dbId:  s.dbId,
      }));
      let lastKeep = -1;
      for (let i = 0; i < all.length; i++) {
        if (all[i].value.trim().length > 0 || all[i].dbId) lastKeep = i;
      }
      return all.slice(0, lastKeep + 1);
    };
    const draft: RecordResultsDraft = {
      campaignId,
      names: {
        TM: collect(membersRows),
        P:  collect(partialRows),
        F:  collect(fullRows),
        SP: collect(fullSinnersRows),
        IR: collect(informationRows),
      },
      actualLeader,
      teamSize,
      ppCnt,
      fpCnt,
      fpspCnt,
      irCnt,
      updatedAt: new Date().toISOString(),
    };
    saveResultsDraft(draft);
    setHasUnsavedDraft(draftHasContent(draft));
  }, [
    campaignId, isLoading,
    membersRows, partialRows, fullRows, fullSinnersRows, informationRows,
    actualLeader, teamSize, ppCnt, fpCnt, fpspCnt, irCnt,
  ]);

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

    const emptyRow = (): InputRow => ({
      id: generateId(),
      slots: [emptySlot(), emptySlot(), emptySlot()],
    });

    // Build rows from a flat list of slots, grouped 3-per-row. Slots are
    // already in the correct {value, dbId} shape so existing dbIds are
    // preserved through restore.
    const createRowsFromSlots = (slots: NameSlot[]): InputRow[] => {
      const rows: InputRow[] = [];
      for (let i = 0; i < slots.length; i += 3) {
        rows.push({
          id: generateId(),
          slots: [
            slots[i]     ?? emptySlot(),
            slots[i + 1] ?? emptySlot(),
            slots[i + 2] ?? emptySlot(),
          ],
        });
      }
      if (rows.length === 0) rows.push(emptyRow());
      return rows;
    };

    const slotsFromDbRows = (rows: ResultRow[], category: ResultsCategory): NameSlot[] =>
      rows.filter((r) => r.category_code === category).map((r) => ({ value: r.first_name, dbId: r.id }));

    const slotsFromDraft = (drafts: NameSlotDraft[]): NameSlot[] =>
      drafts.map((d) => ({ value: d.value, dbId: d.dbId }));

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

        // `originalEntries` always reflects ground truth from the server — the
        // autosave diff logic depends on this to compute correct insert/update/deletes.
        const origMap = new Map<string, { first_name: string; category_code: ResultsCategory }>();
        for (const r of existing) {
          origMap.set(r.id, { first_name: r.first_name, category_code: r.category_code as ResultsCategory });
        }
        setOriginalEntries(origMap);

        // If a locally-buffered draft exists for this campaign, restore the
        // visible form state (including each slot's dbId) from it — that's the
        // user's last known intent and covers cases where the server-side save
        // failed silently last time. `originalEntries` still reflects what the
        // server actually has, so the next autosave computes the right diff.
        const draft = loadResultsDraft(cid);
        if (draft && draftHasContent(draft)) {
          setMembersRows(createRowsFromSlots(slotsFromDraft(draft.names.TM)));
          setPartialRows(createRowsFromSlots(slotsFromDraft(draft.names.P)));
          setFullRows(createRowsFromSlots(slotsFromDraft(draft.names.F)));
          setFullSinnersRows(createRowsFromSlots(slotsFromDraft(draft.names.SP)));
          setInformationRows(createRowsFromSlots(slotsFromDraft(draft.names.IR)));
          if (draft.actualLeader) setActualLeader(draft.actualLeader);
          if (draft.teamSize)     setTeamSize(draft.teamSize);
          if (draft.ppCnt)        setPpCnt(draft.ppCnt);
          if (draft.fpCnt)        setFpCnt(draft.fpCnt);
          if (draft.fpspCnt)      setFpspCnt(draft.fpspCnt);
          if (draft.irCnt)        setIrCnt(draft.irCnt);
          setDraftRestoredAt(draft.updatedAt);
          setHasUnsavedDraft(true);
        } else {
          setMembersRows(createRowsFromSlots(slotsFromDbRows(existing, 'TM')));
          setPartialRows(createRowsFromSlots(slotsFromDbRows(existing, 'P')));
          setFullRows(createRowsFromSlots(slotsFromDbRows(existing, 'F')));
          setFullSinnersRows(createRowsFromSlots(slotsFromDbRows(existing, 'SP')));
          setInformationRows(createRowsFromSlots(slotsFromDbRows(existing, 'IR')));
          if (existing.length === 0) {
            setMembersRows([emptyRow()]);
            setPartialRows([emptyRow()]);
            setFullRows([emptyRow()]);
            setFullSinnersRows([emptyRow()]);
            setInformationRows([emptyRow()]);
          }
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
      await withRetry(async () => {
        const oldData = await fetchCampaignData(cid);
        await updateCampaign(cid, { team_size: parsed }, oldData);
      });
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
      await withRetry(async () => {
        const oldData = await fetchCampaignData(cid);
        await updateCampaign(cid, { actual_leader: value }, oldData);
      });
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
      await withRetry(async () => {
        const oldData = await fetchCampaignData(cid);
        await updateCampaign(cid, { pp_cnt: current.pp, fp_cnt: current.fp, fpsp_cnt: current.fpsp, ir_cnt: current.ir }, oldData);
      });
      lastSavedCountsRef.current = current;
    } catch (error) {
      console.error('Error saving count fields:', error);
      setSaveStatus('error');
    }
  };

  // Save all pending names. Guarded against concurrent runs (prevents saving "M", "Muh" mid-type).
  // If an edit comes in while a save is already in flight, rerunNamesRef marks
  // that another pass is needed once the current one finishes, so the edit
  // isn't silently dropped.
  //
  // Each name slot carries its own server-side primary key (`dbId`). The save
  // diff is therefore by id, not by name: two attendees named "John" in the
  // same category get two distinct rows because they're two distinct slots
  // with two distinct dbIds.
  const savePendingNames = useCallback(async () => {
    if (savingNamesRef.current) {
      rerunNamesRef.current = true;
      return;
    }
    const currentCampaignId = campaignIdRef.current;
    if (!currentCampaignId) return;

    savingNamesRef.current = true;
    setSaveStatus('saving');

    // Captured outside the try block so the catch handler can log what we attempted.
    const attemptedUpserts: ResultsLogRow[] = [];
    const attemptedDeletes: ResultsLogRow[] = [];

    try {
      const userId = userIdRef.current;
      if (!userId) throw new Error('User not authenticated');

      const original = originalEntriesRef.current;

      // ----------------------------------------------------------------------
      // Walk every slot in every section, classify into insert / update / delete.
      // `slotKey` is `${category}:${rowId}:${slotIndex}` — a stable handle so we
      // can apply the server-returned ids back onto form state in one update.
      // ----------------------------------------------------------------------
      type Action =
        | { kind: 'insert'; key: string; category: ResultsCategory; value: string }
        | { kind: 'update'; key: string; id: string; category: ResultsCategory; value: string }
        | { kind: 'delete'; key: string | null; id: string; category: ResultsCategory; value: string };

      const actions: Action[] = [];
      const seenDbIds = new Set<string>();

      const walk = (rows: InputRow[], category: ResultsCategory) => {
        rows.forEach((row) => {
          row.slots.forEach((slot, idx) => {
            const key = `${category}:${row.id}:${idx}`;
            const value = slot.value.trim();
            if (slot.dbId) {
              seenDbIds.add(slot.dbId);
              if (!value) {
                actions.push({ kind: 'delete', key, id: slot.dbId, category, value: original.get(slot.dbId)?.first_name ?? '' });
              } else {
                const orig = original.get(slot.dbId);
                if (!orig || orig.first_name !== value || orig.category_code !== category) {
                  actions.push({ kind: 'update', key, id: slot.dbId, category, value });
                }
              }
            } else if (value) {
              actions.push({ kind: 'insert', key, category, value });
            }
          });
        });
      };
      walk(membersRowsRef.current,      'TM');
      walk(partialRowsRef.current,      'P');
      walk(fullRowsRef.current,         'F');
      walk(fullSinnersRowsRef.current,  'SP');
      walk(informationRowsRef.current,  'IR');

      // dbIds that exist on the server but no longer appear in any slot
      // (e.g. the user removed the whole row containing them).
      for (const [dbId, entry] of original) {
        if (!seenDbIds.has(dbId)) {
          actions.push({ kind: 'delete', key: null, id: dbId, category: entry.category_code, value: entry.first_name });
        }
      }

      const inserts = actions.filter((a): a is Extract<Action, { kind: 'insert' }> => a.kind === 'insert');
      const updates = actions.filter((a): a is Extract<Action, { kind: 'update' }> => a.kind === 'update');
      const deletes = actions.filter((a): a is Extract<Action, { kind: 'delete' }> => a.kind === 'delete');

      inserts.forEach((a) => attemptedUpserts.push({ first_name: a.value, category_code: a.category }));
      updates.forEach((a) => attemptedUpserts.push({ first_name: a.value, category_code: a.category }));
      deletes.forEach((a) => attemptedDeletes.push({ first_name: a.value, category_code: a.category }));

      // ----------------------------------------------------------------------
      // Apply inserts first so we can attach returned dbIds back to slots and
      // include the new ids in the updated originalEntries map.
      // ----------------------------------------------------------------------
      const newIdsByKey = new Map<string, string>();
      if (inserts.length) {
        const rows = inserts.map((a) => ({
          campaign_id:   currentCampaignId,
          first_name:    a.value,
          category_code: a.category,
          user_id:       userId,
        }));
        const inserted = await withRetry(() => insertResults(rows));
        inserted.forEach((row, i) => {
          newIdsByKey.set(inserts[i].key, row.id);
        });
      }

      // Updates can run concurrently. Failures throw out — caught below.
      if (updates.length) {
        await withRetry(() => Promise.all(updates.map((a) => updateResult(a.id, { first_name: a.value, category_code: a.category }))));
      }

      // Deletes likewise.
      const clearedDbIdsByKey = new Set<string>();
      if (deletes.length) {
        await withRetry(() => Promise.all(deletes.map((a) => deleteResult(a.id))));
        deletes.forEach((a) => { if (a.key) clearedDbIdsByKey.add(a.key); });
      }

      // ----------------------------------------------------------------------
      // Apply the dbId updates back onto form state and recompute originalEntries.
      // ----------------------------------------------------------------------
      const applyIds = (rows: InputRow[], category: ResultsCategory): InputRow[] =>
        rows.map((row) => ({
          ...row,
          slots: row.slots.map((slot, idx) => {
            const key = `${category}:${row.id}:${idx}`;
            if (newIdsByKey.has(key))     return { ...slot, dbId: newIdsByKey.get(key)! };
            if (clearedDbIdsByKey.has(key)) return { ...slot, dbId: null };
            return slot;
          }) as [NameSlot, NameSlot, NameSlot],
        }));

      if (newIdsByKey.size > 0 || clearedDbIdsByKey.size > 0) {
        setMembersRows(     (prev) => applyIds(prev, 'TM'));
        setPartialRows(     (prev) => applyIds(prev, 'P'));
        setFullRows(        (prev) => applyIds(prev, 'F'));
        setFullSinnersRows( (prev) => applyIds(prev, 'SP'));
        setInformationRows( (prev) => applyIds(prev, 'IR'));
      }

      const nextOriginal = new Map(original);
      for (const id of deletes.map((d) => d.id)) nextOriginal.delete(id);
      for (const u of updates) nextOriginal.set(u.id, { first_name: u.value, category_code: u.category });
      inserts.forEach((a, i) => {
        const id = newIdsByKey.get(a.key);
        if (id) nextOriginal.set(id, { first_name: a.value, category_code: a.category });
        void i; // index used implicitly via the matching newIdsByKey lookup
      });
      setOriginalEntries(nextOriginal);
      originalEntriesRef.current = nextOriginal;

      setSaveStatus('saved');
      if (saveStatusTimerRef.current) clearTimeout(saveStatusTimerRef.current);
      saveStatusTimerRef.current = setTimeout(() => setSaveStatus('idle'), 3000);

      logResultsSave({
        campaignId: currentCampaignId,
        status: 'SUCCESS',
        attemptedUpserts,
        attemptedDeletes,
      });

      // Names have reached the server — the localStorage backup is no longer
      // needed and would otherwise trigger a "restored unsaved names" banner
      // on the next page load.
      clearResultsDraft(currentCampaignId);
      setHasUnsavedDraft(false);
      setDraftRestoredAt(null);

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
      const errorMessage = getErrorMessage(error);
      logResultsSave({
        campaignId: currentCampaignId,
        status: 'ERROR',
        attemptedUpserts,
        attemptedDeletes,
        errorMessage,
      });
      trackEvent('record_results_save_error', {
        state:    campaignData.state  || undefined,
        leader:   campaignData.leader || undefined,
        upserts:  attemptedUpserts.length,
        deletes:  attemptedDeletes.length,
        error:    errorMessage,
      });

      // Re-pull the actual server state and rebuild the local "what's saved"
      // baseline from truth. Otherwise originalEntriesRef can drift after a
      // partial failure (e.g. some updates succeeded but a delete failed),
      // and the next save would compute the wrong diff.
      try {
        const fresh = await getResultsByCampaignId(currentCampaignId);
        const freshMap = new Map<string, { first_name: string; category_code: ResultsCategory }>();
        for (const r of fresh) freshMap.set(r.id, { first_name: r.first_name, category_code: r.category_code as ResultsCategory });
        setOriginalEntries(freshMap);
        originalEntriesRef.current = freshMap;
      } catch (refetchError) {
        console.error('Error refetching results after save failure:', refetchError);
      }
    } finally {
      savingNamesRef.current = false;
      if (rerunNamesRef.current) {
        rerunNamesRef.current = false;
        savePendingNames();
      }
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

  // Debounced save for the actual-leader field, mirroring scheduleSaveNames.
  // Needed because onBlur alone is not reliable on iOS Safari (e.g. tapping a
  // button directly can skip the blur event), so the field is also saved a
  // couple of seconds after the user stops typing.
  const scheduleSaveActualLeader = useCallback(() => {
    if (debounceActualLeaderTimerRef.current) clearTimeout(debounceActualLeaderTimerRef.current);
    debounceActualLeaderTimerRef.current = setTimeout(() => {
      debounceActualLeaderTimerRef.current = null;
      saveActualLeader();
    }, DEBOUNCE_MS);
  }, [saveActualLeader]);

  // Auto-save periodically and on navigation/unmount
  useEffect(() => {
    const autoSaveInterval = setInterval(() => {
      if (campaignIdRef.current) {
        saveTeamSize();
        saveActualLeader();
        saveCountFields();
        // Names that failed to save earlier (network blip, RLS hiccup, etc.)
        // are retried here too — savePendingNames is a no-op if there's
        // nothing pending, so this is safe to call unconditionally.
        savePendingNames();
      }
    }, 3000);

    const flushAll = () => {
      if (campaignIdRef.current) {
        flushSaveNames();
        saveTeamSize();
        saveActualLeader();
        saveCountFields();
      }
    };

    // Retry immediately when connectivity is restored, instead of waiting
    // for the next 3-second tick or the next edit.
    window.addEventListener('online', flushAll);

    // beforeunload is unreliable on iOS/Safari (especially in standalone PWA
    // mode), so pagehide and visibilitychange are used as the primary signals
    // for flushing pending saves when the page is backgrounded or closed.
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') flushAll();
    };

    window.addEventListener('beforeunload', flushAll);
    window.addEventListener('pagehide', flushAll);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    // Separate guard: if there's a localStorage draft (= unsaved edits) at the
    // moment the page is being closed, prompt the user before leaving. This is
    // the browser's standard "Leave site?" dialog — it can't be styled, and
    // some browsers ignore it for fast/instant tab closes, but it catches the
    // most common "I clicked Back and lost my work" path.
    const handleBeforeUnloadGuard = (e: BeforeUnloadEvent) => {
      const cid = campaignIdRef.current;
      if (!cid) return;
      const draft = loadResultsDraft(cid);
      if (draft && draftHasContent(draft)) {
        e.preventDefault();
        // Required for older browsers to actually show the dialog.
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnloadGuard);

    return () => {
      clearInterval(autoSaveInterval);
      window.removeEventListener('online', flushAll);
      window.removeEventListener('beforeunload', flushAll);
      window.removeEventListener('beforeunload', handleBeforeUnloadGuard);
      window.removeEventListener('pagehide', flushAll);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (debounceNamesTimerRef.current) {
        clearTimeout(debounceNamesTimerRef.current);
        debounceNamesTimerRef.current = null;
      }
      if (debounceActualLeaderTimerRef.current) {
        clearTimeout(debounceActualLeaderTimerRef.current);
        debounceActualLeaderTimerRef.current = null;
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
  }, [flushSaveNames, savePendingNames]);

  const addNewRow = (section: SectionType) => {
    const newRow: InputRow = { id: generateId(), slots: [emptySlot(), emptySlot(), emptySlot()] };
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
    slotIndex: 0 | 1 | 2,
    value: string,
  ) => {
    const update = (prev: InputRow[]) =>
      prev.map((row) => {
        if (row.id !== rowId) return row;
        const slots = row.slots.map((s, i) => (i === slotIndex ? { ...s, value } : s)) as [NameSlot, NameSlot, NameSlot];
        return { ...row, slots };
      });
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
    slotIndex: 0 | 1 | 2,
    value: string,
  ) => {
    updateRowField(section, rowId, slotIndex, value);
    if (campaignId) scheduleSaveNames();
  };

  const renderInputGrid = (rows: InputRow[], section: SectionType) => (
    <div className="space-y-2">
      {rows.map((row) => (
        <div key={row.id} className="flex gap-2 w-full">
          {([0, 1, 2] as const).map((idx) => (
            <input
              key={idx}
              type="text"
              value={row.slots[idx].value}
              onChange={(e) => handleNameChange(section, row.id, idx, e.target.value)}
              maxLength={255}
              className="flex-1 min-w-0 rounded-md border-2 border-gray-400 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500 dark:border-gray-500 dark:bg-gray-900 dark:text-white"
              placeholder="Enter first name"
            />
          ))}
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

        {/* Restored-from-draft banner: shows once when the page reloads with
            unsaved edits from a previous visit. */}
        {draftRestoredAt && (
          <div className="mb-4 rounded-lg border-2 border-amber-500 bg-amber-100 px-4 py-3 shadow-sm dark:border-amber-400 dark:bg-amber-900/40">
            <div className="flex items-start gap-3">
              <div className="flex-shrink-0 mt-0.5">
                <svg className="h-5 w-5 text-amber-700 dark:text-amber-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-amber-900 dark:text-amber-100">
                  Restored your unsaved entries from{' '}
                  {(() => {
                    const d = new Date(draftRestoredAt);
                    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) +
                           ' on ' +
                           d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                  })()}
                </p>
                <p className="mt-1 text-xs text-amber-800 dark:text-amber-200">
                  The previous save didn&apos;t complete, so we&apos;ve put your typing back on screen. It will save again automatically.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Auto-save status banner. Stays sticky-red while there are unsaved
            edits or a save has failed, so the user can't walk away thinking
            the data is safe when it isn't. */}
        {(() => {
          const isFailing = saveStatus === 'error';
          const isSaving  = saveStatus === 'saving';
          const isUnsaved = hasUnsavedDraft && !isSaving && !isFailing;
          const isClean   = !hasUnsavedDraft && !isFailing && !isSaving;

          const tone = isFailing
            ? 'border-red-500 bg-red-100 dark:border-red-400 dark:bg-red-900/40'
            : isUnsaved
              ? 'border-amber-500 bg-amber-100 dark:border-amber-400 dark:bg-amber-900/40'
              : 'border-blue-400 bg-blue-100 dark:border-blue-500 dark:bg-blue-900/40';

          const heading = isFailing
            ? 'Save failed — check your connection'
            : isUnsaved
              ? 'Unsaved entries — saving in the background'
              : isSaving
                ? 'Saving your entries…'
                : 'All entries saved';

          const body = isFailing
            ? 'Your typing is safe on this device — we will keep retrying. Please stay on this page until the banner turns green.'
            : isUnsaved
              ? 'Your entries are kept on this device and will save shortly. Please stay on the page until you see the green confirmation.'
              : isSaving
                ? 'Sending your entries to the server.'
                : 'All your entries are saved automatically every few seconds. There is no need to click a Save button.';

          return (
            <div className={`mb-6 rounded-lg border-2 px-4 py-3 shadow-sm ${tone}`}>
              <div className="flex items-start gap-3">
                <div className="flex-shrink-0 mt-0.5">
                  <svg className="h-5 w-5 text-current opacity-80" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <div className="flex-1">
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">{heading}</p>
                    {isSaving  && <span className="flex-shrink-0 text-xs font-medium text-blue-700 dark:text-blue-300 animate-pulse">Saving…</span>}
                    {isClean   && <span className="flex-shrink-0 text-xs font-medium text-green-700 dark:text-green-400">✓ Saved</span>}
                    {isFailing && <span className="flex-shrink-0 text-xs font-bold text-red-700 dark:text-red-300">! Not saved</span>}
                    {isUnsaved && <span className="flex-shrink-0 text-xs font-medium text-amber-800 dark:text-amber-200">● Pending</span>}
                  </div>
                  <p className="text-xs text-gray-800 dark:text-gray-200">{body}</p>
                </div>
              </div>
            </div>
          );
        })()}

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
            onChange={(e) => { setActualLeader(e.target.value); scheduleSaveActualLeader(); }}
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
