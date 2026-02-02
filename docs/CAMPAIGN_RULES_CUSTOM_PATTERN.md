# Campaign Rules: Custom Pattern (via JSONB config)

## Current state

- **Frequency Type = Custom** is available in the Campaign Rules UI.
- The **rule_config** column (JSONB) can store arbitrary JSON for any rule.
- The evaluation engine currently treats Custom as a **stub**: `evaluateCustomPattern()` returns an empty array, so **no campaigns are generated** for Custom rules until the engine is extended.

The Custom option exists so you can:
1. Store rule metadata and future pattern data in **rule_config**.
2. Extend the engine later to interpret that JSON and generate dates **without** changing the database schema.

---

## How the Custom pattern is intended to work

1. You create a rule with **Frequency Type = Custom** and fill in the usual fields (Leader, State, Place, Time, etc.).
2. You put the **pattern definition** into **rule_config** (JSON). The engine would read this and compute which dates in the target period match the pattern.
3. When Weekly Refresh (or preview) runs, the engine calls `evaluateCustomPattern(rule_config, startDate, endDate)`. That function would:
   - Parse `rule_config`.
   - Compute all dates in `[startDate, endDate]` that match the pattern.
   - Return those dates; the rest of the pipeline turns them into campaign records.

So: **Custom pattern = “which dates?” is defined entirely by the JSON in rule_config**, instead of by the fixed weekly/biweekly/monthly logic.

---

## Proposed rule_config format for Custom

You can design the JSON however you like when you extend the engine. Below is a suggested structure that fits the existing concepts (exceptions, overrides) and is easy to extend.

### Option A: Explicit list of dates

Generate campaigns only on these dates (e.g. maintained by an admin or another process):

```json
{
  "custom_type": "explicit_dates",
  "dates": [
    "2026-02-15",
    "2026-02-22",
    "2026-03-01"
  ]
}
```

Engine behaviour: for each date in `dates` that falls within `[startDate, endDate]`, add one campaign.

### Option B: Pattern + exceptions

Use a simple pattern (e.g. “every Friday”) and exclude specific dates:

```json
{
  "custom_type": "weekly_with_exceptions",
  "day_of_week": 5,
  "exceptions": [
    "2026-02-14",
    "2026-03-21"
  ]
}
```

Engine behaviour: every Friday in the range, minus any date in `exceptions`.

### Option C: First/third week of month (example complex pattern)

```json
{
  "custom_type": "specific_weeks_of_month",
  "weeks_of_month": [1, 3],
  "day_of_week": 4
}
```

Engine behaviour: 1st and 3rd Thursday of each month in the range.

Other patterns (e.g. “first and last Saturday”) can be added by defining new `custom_type` values and implementing the corresponding logic in `evaluateCustomPattern()`.

---

## Step-by-step setup (once the engine supports your JSON format)

### 1. Create the rule in the UI

1. Go to **Admin → Campaign Rules**.
2. Click **Add New Campaign Rule** (or edit an existing one).
3. Fill in:
   - **Rule name** (e.g. “Custom – First and third Thursday”).
   - **State**, **Place**, **Leader**, **Time** (and optional Mobile, Notes, etc.).
   - **Frequency Type**: select **Custom**.
   - **Start date** / **End date** (optional) to limit the rule’s active period.
   - **Priority** and **Active** as needed.
4. Save. This creates the row and sets `frequency_type = 'custom'`. The UI does not yet edit **rule_config** for Custom, so `rule_config` will be `{}` after this step.

### 2. Put your pattern into rule_config

Because the Admin UI does not yet have a “Custom config” or JSON editor for **rule_config**, you have to set it outside the form.

**Option 2a – Supabase Dashboard**

1. Open Supabase → **Table Editor** → **campaign_rules**.
2. Find the rule you created (e.g. by name or time).
3. Open the **rule_config** cell and paste your JSON, e.g.:

   ```json
   {
     "custom_type": "explicit_dates",
     "dates": ["2026-02-15", "2026-02-22", "2026-03-01"]
   }
   ```

4. Save the row.

**Option 2b – SQL**

```sql
UPDATE campaign_rules
SET rule_config = '{
  "custom_type": "explicit_dates",
  "dates": ["2026-02-15", "2026-02-22", "2026-03-01"]
}'::jsonb
WHERE name = 'Your rule name here';
```

Replace the JSON and `WHERE` condition as needed.

### 3. Implement or extend evaluateCustomPattern()

Until the engine knows how to read your JSON, Custom rules will still generate no campaigns.

1. Open **lib/campaignRules.ts**.
2. Find **evaluateCustomPattern(ruleConfig, startDate, endDate)**.
3. Implement the logic for your `rule_config` shape, for example:

```ts
function evaluateCustomPattern(
  ruleConfig: any,
  startDate: Date,
  endDate: Date
): Date[] {
  if (!ruleConfig?.custom_type) return [];

  const start = new Date(startDate);
  start.setHours(0, 0, 0, 0);
  const end = new Date(endDate);
  end.setHours(23, 59, 59, 999);
  const matches: Date[] = [];

  if (ruleConfig.custom_type === 'explicit_dates' && Array.isArray(ruleConfig.dates)) {
    for (const dateStr of ruleConfig.dates) {
      const d = new Date(dateStr);
      d.setHours(0, 0, 0, 0);
      if (d >= start && d <= end) matches.push(d);
    }
  }

  // Add more custom_type branches here (e.g. weekly_with_exceptions, specific_weeks_of_month).

  return matches;
}
```

4. Save and run **Weekly Refresh** or **Preview** again; the Custom rule should now generate campaigns for dates that match your config.

### 4. Optional: exceptions and overrides

- **exceptions**: If you add an `exceptions` array to **rule_config**, the existing `isDateExcepted()` logic will exclude those dates from **any** rule (including Custom), as long as you still pass `rule.rule_config` into the filter.
- **override_fields**: You can use `rule_config.override_fields` to override time (or other fields) per date, e.g. `"2026-02-15": { "time": "14:00:00" }`. The existing campaign-generation code already checks `rule_config.override_fields?.[dateStr]` when building the campaign object.

No extra setup is required for these beyond putting the right keys in **rule_config**.

---

## Summary

| Step | Action |
|------|--------|
| 1 | Create a rule in Admin with **Frequency Type = Custom** and save. |
| 2 | Set **rule_config** in Supabase (Table Editor or SQL) to your JSON pattern. |
| 3 | Extend **evaluateCustomPattern()** in **lib/campaignRules.ts** to interpret that JSON and return the matching dates in the given range. |
| 4 | Use **Preview** or **Weekly Refresh** to confirm campaigns are generated as expected. |

Once the engine supports your chosen **rule_config** format, the Custom pattern works like this: **rule_config** (JSONB) defines “which dates”; the engine computes those dates in the target period and creates one campaign per date using the rule’s Leader, Place, Time, etc.
