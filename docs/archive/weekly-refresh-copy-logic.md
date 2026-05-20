# Archived: Copy-from-Past-Week Logic (Weekly Refresh)

Removed from `app/admin/page.tsx` → `handleWeeklyRefresh` on 2026-05-20.
All states had already been de-activated from copy mode before removal.

---

## Removed imports

```typescript
import { getAllStateRefreshSettings, DEFAULT_REFRESH_MODE, type RefreshMode } from '@/lib/stateRefreshSettings';
```

---

## Removed variables (top of handleWeeklyRefresh, after secondWeekEnd)

```typescript
const pastWeekStart = new Date(dates.pastCampaignStart);
const pastWeekEnd = new Date(pastWeekStart);
pastWeekEnd.setDate(pastWeekEnd.getDate() + 6); // Add 6 days to get to Sunday
const pastWeekStartStr = formatDateForDb(pastWeekStart);
const pastWeekEndStr = formatDateForDb(pastWeekEnd);
const daysDifference = Math.floor(
  (secondWeekStart.getTime() - pastWeekStart.getTime()) / (1000 * 60 * 60 * 24)
);

// Per-state refresh mode (state reporters set this in SR Admin)
const stateSettings = await getAllStateRefreshSettings();
```

---

## Removed: pastCampaigns fetch (ran immediately after the stateSettings line)

```typescript
// Fetch all past week campaigns and all active rules once
const { data: pastCampaigns, error: fetchError } = await supabase
  .from('campaigns')
  .select('*')
  .gte('date', pastWeekStartStr)
  .lte('date', pastWeekEndStr)
  .order('date', { ascending: true });
if (fetchError) throw fetchError;
```

---

## Removed: copyCount variable (was declared alongside rulesCount)

```typescript
let copyCount = 0;
```

---

## Removed: per-state mode branching (the entire body of the `for (const state of states)` loop was replaced)

```typescript
for (const state of states) {
  const mode: RefreshMode = stateSettings.get(state) ?? DEFAULT_REFRESH_MODE;
  const statePast = (pastCampaigns || []).filter((c: { state: string }) => c.state === state);
  const stateRules = allRules.filter((r) => r.state === state);

  let copiedForState: NewCampaignRow[] = [];
  if (mode === 'copy' || mode === 'both' || mode === 'either') {
    copiedForState = statePast.map((campaign) => {
      const originalDate = new Date(campaign.date);
      const newDate = new Date(originalDate);
      newDate.setDate(newDate.getDate() + daysDifference);
      return {
        date: formatDateForDb(newDate),
        state: campaign.state,
        place: campaign.place,
        time: campaign.time,
        leader: campaign.leader,
        mobile: campaign.mobile,
        botj: campaign.botj,
        category: campaign.category ?? 'TWOL',
        user_id: campaign.user_id,
        team_size: null,
        tl_ok: false,
        source: 'CFP',
      };
    });
    if (mode !== 'either') copyCount += copiedForState.length;
  }

  let generatedForState: NewCampaignRow[] = [];
  if (mode === 'rules' || mode === 'both' || mode === 'either') {
    const ruleCampaigns = evaluateRules(stateRules, secondWeekStart, secondWeekEnd);
    generatedForState = ruleCampaigns.map((campaign) => ({
      date: campaign.date,
      state: campaign.state,
      place: campaign.place,
      time: campaign.time,
      leader: campaign.leader,
      mobile: campaign.mobile,
      botj: null,
      category: campaign.category ?? 'TWOL',
      user_id: user.id,
      team_size: null,
      tl_ok: false,
      source: 'RUL',
    }));
    rulesCount += generatedForState.length;
    rulesUsedInRefresh.push(...stateRules);
  }

  if (mode === 'copy') {
    allNewCampaigns.push(...copiedForState);
  } else if (mode === 'rules') {
    allNewCampaigns.push(...generatedForState);
  } else if (mode === 'either') {
    // Slots covered by rules (state, place, time, leader) — do not copy for these
    const ruleSlots = new Set(
      generatedForState.map((c) => `${c.state}_${c.place}_${c.time}_${c.leader}`)
    );
    const copyOnlyWhenNoRule = copiedForState.filter(
      (c) => !ruleSlots.has(`${c.state}_${c.place}_${c.time}_${c.leader}`)
    );
    copyCount += copyOnlyWhenNoRule.length;
    allNewCampaigns.push(...generatedForState, ...copyOnlyWhenNoRule);
  } else {
    const conflictMap = new Map<string, NewCampaignRow>();
    copiedForState.forEach((c) => {
      conflictMap.set(`${c.date}_${c.state}_${c.place}_${c.time}`, c);
    });
    generatedForState.forEach((c) => {
      conflictMap.set(`${c.date}_${c.state}_${c.place}_${c.time}`, c);
    });
    allNewCampaigns.push(...Array.from(conflictMap.values()));
  }
}
```

---

## Removed: copyCount in summary message

```typescript
message += `Copied ${copyCount} from past week and generated ${rulesCount} from rules (per-state modes). `;
```

Was replaced with:

```typescript
message += `Generated ${rulesCount} from rules. `;
```
