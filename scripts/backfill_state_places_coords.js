/**
 * Geocode state_places rows via Nominatim and persist the result.
 *
 * Why: the admin Campaign Map and Campaigns Near Me screens geocode on demand,
 * but Nominatim caps requests at 1/sec — so the first time a new place appears
 * on either map the user waits ~1.1 s per uncached place. Backfilling once
 * means subsequent map loads are instant.
 *
 * Geocodes against the `location` column (the actual suburb/town), not `place`
 * (which is often a venue/event name) — see docs/migrations/006_add_state_places_location.sql.
 * Rows without a `location` set are skipped; run
 * `node scripts/backfill_state_places_location.js --apply` first.
 *
 * By default only rows missing latitude/longitude are processed. Pass --force to
 * recompute every row with a location set, even ones that already have coordinates —
 * use this after correcting `location` values, since the cached coordinates may still
 * reflect the old (pre-correction) query.
 *
 * Usage:
 *   node scripts/backfill_state_places_coords.js                # dry-run, missing coords only
 *   node scripts/backfill_state_places_coords.js --apply         # geocode + write missing coords
 *   node scripts/backfill_state_places_coords.js --force         # dry-run, recompute every row
 *   node scripts/backfill_state_places_coords.js --force --apply # recompute + write every row
 *
 * Requirements:
 *   .env.local with NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
 *
 * Safety: idempotent in default mode — rows that already have coords are skipped, so
 * the script can be re-run any time new places are added. --force is not idempotent
 * in the sense that it overwrites existing coordinates on every run; Nominatim can
 * occasionally return a slightly different top match for the same query between runs.
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
const force = process.argv.includes('--force');
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

// Nominatim's policy caps requests at 1/sec; 1.1 s gives headroom and matches
// the existing on-demand pipeline so behaviour is consistent.
const NOMINATIM_GAP_MS = 1100;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A few rows are administratively grouped under one state (`state_places.state`,
// which drives who manages them / which campaign group they belong to) but are
// physically located in another — geocoding with the row's own state then finds
// no match. Override the state used in the *geocode query only* for these; the
// stored `state` column is untouched.
const GEOCODE_STATE_OVERRIDES = {
  'f9811c68-0c9a-45e2-890a-e94fdcf0331c': 'NSW', // ACT :: Jervis Bay — physically on the NSW south coast
  '4dd81bed-5b01-433b-91b6-629cbece75f9': 'NSW', // ACT :: Sanctuary Point — physically on the NSW south coast
};

async function geocode(location, state) {
  const query = `${location}, ${state}, Australia`;
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=au&q=${encodeURIComponent(query)}`;
  let response;
  try {
    response = await fetch(url, {
      headers: {
        'Accept-Language': 'en',
        'User-Agent': 'campaign-app (state_places one-off backfill)',
      },
      signal: AbortSignal.timeout(10000),
    });
  } catch (err) {
    return { error: `fetch failed: ${err.message}` };
  }
  if (!response.ok) return { error: `HTTP ${response.status}` };
  const results = await response.json();
  if (!Array.isArray(results) || results.length === 0) return { error: 'no match' };
  return { latitude: parseFloat(results[0].lat), longitude: parseFloat(results[0].lon) };
}

(async () => {
  let query = supabase
    .from('state_places')
    .select('id, state, place, location, latitude, longitude')
    .order('state', { ascending: true })
    .order('place', { ascending: true });
  if (!force) query = query.or('latitude.is.null,longitude.is.null');

  const { data: candidates, error } = await query;

  if (error) {
    console.error('Failed to query state_places:', error.message, error.code, error.details);
    process.exit(1);
  }

  const rows = (candidates || []).filter((r) => r.location);
  const skippedNoLocation = (candidates || []).filter((r) => !r.location);

  console.log(`${force ? 'Recomputing every row with a location' : 'Found rows missing coordinates'}: ${candidates.length} (${rows.length} have a location set, ${skippedNoLocation.length} skipped for missing location).`);
  if (skippedNoLocation.length > 0) {
    console.log('\nSkipped (no location set):');
    skippedNoLocation.forEach((r) => console.log(`  ${r.state} :: ${r.place}`));
  }
  if (rows.length === 0) {
    console.log('\nNothing to do.');
    return;
  }

  if (!apply) {
    console.log('\nDry run — pass --apply to geocode and write. First 20:');
    rows.slice(0, 20).forEach((r) => console.log(`  ${r.state} :: ${r.place} → location: ${r.location}${force && r.latitude != null ? ` (currently ${r.latitude.toFixed(4)}, ${r.longitude.toFixed(4)})` : ''}`));
    if (rows.length > 20) console.log(`  …and ${rows.length - 20} more.`);
    const estSec = Math.ceil((rows.length * NOMINATIM_GAP_MS) / 1000);
    console.log(`\nEstimated run time at 1 req/${NOMINATIM_GAP_MS}ms: ~${estSec}s (${(estSec / 60).toFixed(1)} min).`);
    return;
  }

  console.log('Applying — geocoding now…\n');
  let ok = 0;
  let failed = 0;
  let changed = 0;
  const failures = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    // Space out lookups to respect Nominatim's 1/sec policy.
    if (i > 0) await sleep(NOMINATIM_GAP_MS);

    const geocodeState = GEOCODE_STATE_OVERRIDES[row.id] || row.state;
    const result = await geocode(row.location, geocodeState);
    if (result.error) {
      failed++;
      failures.push({ state: row.state, place: row.place, reason: result.error });
      console.log(`  [${i + 1}/${rows.length}] ✗ ${row.state} :: ${row.place} (${row.location}) — ${result.error}`);
      continue;
    }

    const moved = row.latitude != null && (Math.abs(row.latitude - result.latitude) > 0.0005 || Math.abs(row.longitude - result.longitude) > 0.0005);
    if (moved) changed++;

    const { error: updateError } = await supabase
      .from('state_places')
      .update({ latitude: result.latitude, longitude: result.longitude })
      .eq('id', row.id);

    if (updateError) {
      failed++;
      failures.push({ state: row.state, place: row.place, reason: `update failed: ${updateError.message}` });
      console.log(`  [${i + 1}/${rows.length}] ✗ ${row.state} :: ${row.place} — update failed: ${updateError.message}`);
    } else {
      ok++;
      console.log(`  [${i + 1}/${rows.length}] ✓ ${row.state} :: ${row.place} → ${result.latitude.toFixed(4)}, ${result.longitude.toFixed(4)}${moved ? '  (changed)' : ''}`);
    }
  }

  console.log(`\nDone. Succeeded: ${ok}. Failed: ${failed}.${force ? ` Moved by >0.0005°: ${changed}.` : ''}`);
  if (failures.length > 0) {
    console.log('\nFailures (re-running the script will retry these):');
    failures.forEach((f) => console.log(`  - ${f.state} :: ${f.place} — ${f.reason}`));
  }
})();
