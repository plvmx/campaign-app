/**
 * One-off backfill: populate state_places.location (the actual suburb/town) from
 * the existing `place` field, now that `location` is the sole source used to derive
 * map coordinates — see docs/migrations/006_add_state_places_location.sql.
 *
 * For the vast majority of rows `place` already *is* a real suburb/town, so the
 * default is simply the trimmed/whitespace-collapsed `place` text. A curated set of
 * overrides (keyed by row id) corrects rows where `place` is a venue/event name, an
 * abbreviation, or otherwise not the actual geocodable location — see OVERRIDES below
 * for the reasoning behind each one. A few rows have no confident answer and are
 * intentionally left unset; they're printed as "NEEDS MANUAL REVIEW" for an admin to
 * fill in via the Manage State Places page.
 *
 * Usage:
 *   node scripts/backfill_state_places_location.js          # dry-run summary
 *   node scripts/backfill_state_places_location.js --apply  # actually write
 *
 * Requirements:
 *   .env.local with NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
 *   docs/migrations/006_add_state_places_location.sql already run in Supabase
 *
 * Safety: idempotent — rows that already have a location are skipped, so the script
 * can be re-run any time new places are added.
 */
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const envPath = path.join('/Users/peterviertmann/Development/campaign-app', '.env.local');
fs.readFileSync(envPath, 'utf-8').split('\n').forEach((line) => {
  const t = line.trim();
  if (!t || t.startsWith('#')) return;
  const [k, ...rest] = t.split('=');
  if (k && rest.length) process.env[k.trim()] = rest.join('=').trim().replace(/^["']|["']$/g, '');
});

const apply = process.argv.includes('--apply');
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

// Row id -> corrected location, for rows where `place` isn't the actual geocodable
// suburb/town. `null` means "no confident answer" — left unset, flagged for manual review.
const OVERRIDES = {
  // ACT
  'f9811c68-0c9a-45e2-890a-e94fdcf0331c': 'Jervis Bay Territory', // place has a trailing space only

  // NSW
  '3e46cbdd-798f-40ad-ba04-2e6523989f33': 'Laurieton', // "Camden Haven" is a region (Laurieton/Dunbogan/North Haven), not a single geocodable place
  '8b409358-7c81-4966-af34-8f3945cced29': null, // "LifeSrce Food" — org/event name, actual suburb unknown
  'e606ffbc-e16c-4c2d-b61f-98b04ec18375': 'Brighton-Le-Sands', // "Brighton Le S" abbreviated
  '7973aabb-df04-4d36-86fa-851f98efc2bb': 'Port Macquarie', // "Pt Macquarie" abbreviated

  // QLD
  'ef62cdcb-711b-4cf7-b4c0-354abfc38b3a': 'Eatons Hill', // place="Bray Park", site="(Eatons Hill)" — site names the actual suburb
  '979c2ad7-4635-425e-91a2-17b233e352c5': 'Norman Gardens', // place="Toowoomba", site="Norman Gardens" — Norman Gardens is a real Rockhampton suburb; site names the actual location
  '58242545-dffc-4b3c-bc42-e0523063f004': 'Charters Towers', // "Charters Twrs" abbreviated

  // SA
  'e16b4468-e219-41a6-9dfd-e65bf69cbf23': 'Loxton', // place="Loxton", site="CoC" (Church of Christ venue) — Loxton is the town
  '67c28f2b-e120-4ca8-8da5-4e59c5c51e4a': 'Oaklands Park', // "Oaklands Stn" — Oaklands Park is the actual Adelaide suburb
  'ef0dc205-7507-43cb-b28e-8f3ba01ca14f': null, // "Riverland Field D[ay]" — a region-wide event, no single town confidently identifiable

  // VIC
  '4fe9dc63-17c6-45ff-8759-b3fd7a02036a': null, // "Lollypop Creek" — not a recognized locality, actual suburb unknown
  '0ee782f0-8b04-41d8-acec-e21d1591760d': 'Berwick', // place="Berwick", site="CoC" (Church of Christ venue)

  // WA
  '12decf72-26f0-4e6c-b0ff-da71609187fe': 'Darch', // place="Darch", site="Kingsway" (Kingsway Regional Sporting Complex is in Darch)
  'dc7a5d72-1694-4b87-82db-6635df391e2e': 'Yagan Square', // "Light Up Perth Yagan Sq" event name
  '110dbf9f-8cbd-46a7-adb3-ad5b786f5a07': 'Yagan Square', // "LightUpPerth Yagan Sq" event name (near-duplicate of the row above)
  'a921d43f-31dd-4d17-904f-303c7cb64852': 'Maylands', // "Maylands Avon Descent Festival" event name — Maylands is the suburb
  '6da9c986-366a-4059-bb18-84ad832886b7': 'Yagan Square', // "Yagan Sq" abbreviated
  '2b87726d-46e0-49dc-8eac-b26e7dda7bb7': 'Perth CBD', // "Perth CBD" site 1
  '80ec0bd5-7997-44fb-b07a-01f86d2149dc': 'Perth CBD', // "Perth CBD" site 2
  '2d48ac5a-0e4e-4909-9fc4-a6420c5618ec': 'Perth CBD', // "Perth CBD" site 3
  '6e5fc07d-33fa-4db5-886a-150a4e52596d': 'Perth CBD', // "Perth CBD" site 4
};

// Rows flagged for a human to double check even though a location value was set —
// existing data looks like it may have an unrelated issue (wrong state, mismatched
// coordinates) that a text backfill shouldn't silently paper over.
const FLAGGED_FOR_REVIEW = {
  '3c862c8a-6481-4c35-a3aa-96f6ce923627': 'state is NSW but "Gungahlin" is an ACT suburb (an ACT "Gungahlin" row already exists) — check for a data-entry error',
  'c835526d-64ef-4122-aec1-8e1b1b2871e4': 'state is NSW but "Mount Isa" is in QLD (a QLD "Mt Isa" row already exists) — check for a data-entry error',
  '86b52039-9389-4607-bee4-4d1f3ea7a62e': 'state is VIC but place is "Hobart"; its cached coordinates (-37.80, 145.23) are in outer Melbourne, not Tasmania — likely a mislabeled place name',
};

function defaultLocation(place) {
  return place.trim().replace(/\s+/g, ' ');
}

(async () => {
  const { data: rows, error } = await supabase
    .from('state_places')
    .select('id, state, place, site, location')
    .order('state', { ascending: true })
    .order('place', { ascending: true });

  if (error) {
    console.error('Failed to query state_places:', error.message, error.code, error.details);
    process.exit(1);
  }

  const toUpdate = [];
  const needsReview = [];
  const alreadySet = [];

  for (const row of rows) {
    if (row.location) {
      alreadySet.push(row);
      continue;
    }
    const hasOverride = Object.prototype.hasOwnProperty.call(OVERRIDES, row.id);
    const value = hasOverride ? OVERRIDES[row.id] : defaultLocation(row.place);
    if (value === null) {
      needsReview.push(row);
      continue;
    }
    toUpdate.push({ ...row, location: value });
  }

  console.log(`Total rows: ${rows.length}`);
  console.log(`Already have a location: ${alreadySet.length}`);
  console.log(`To backfill: ${toUpdate.length}`);
  console.log(`Needs manual review (no confident location): ${needsReview.length}`);

  if (needsReview.length > 0) {
    console.log('\nNEEDS MANUAL REVIEW (location left unset):');
    needsReview.forEach((r) => console.log(`  ${r.state} :: ${r.place}${r.site ? ` / ${r.site}` : ''}`));
  }

  const flaggedRows = rows.filter((r) => FLAGGED_FOR_REVIEW[r.id]);
  if (flaggedRows.length > 0) {
    console.log('\nFLAGGED FOR REVIEW (a location was still set, but the underlying row looks suspect):');
    flaggedRows.forEach((r) => console.log(`  ${r.state} :: ${r.place}${r.site ? ` / ${r.site}` : ''} — ${FLAGGED_FOR_REVIEW[r.id]}`));
  }

  if (!apply) {
    console.log('\nDry run — pass --apply to write. Preview of changes:');
    toUpdate.forEach((r) => console.log(`  ${r.state} :: ${r.place}${r.site ? ` / ${r.site}` : ''} → location: "${r.location}"`));
    return;
  }

  console.log('\nApplying…\n');
  let ok = 0;
  let failed = 0;
  for (const row of toUpdate) {
    const { error: updateError } = await supabase
      .from('state_places')
      .update({ location: row.location })
      .eq('id', row.id);
    if (updateError) {
      failed++;
      console.log(`  ✗ ${row.state} :: ${row.place} — ${updateError.message}`);
    } else {
      ok++;
      console.log(`  ✓ ${row.state} :: ${row.place} → "${row.location}"`);
    }
  }
  console.log(`\nDone. Succeeded: ${ok}. Failed: ${failed}.`);
})();
