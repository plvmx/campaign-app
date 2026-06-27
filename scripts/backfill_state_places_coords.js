/**
 * One-off backfill: geocode every state_places row missing latitude/longitude
 * via Nominatim, persist the result.
 *
 * Why: the admin Campaign Map and Campaigns Near Me screens geocode on demand,
 * but Nominatim caps requests at 1/sec — so the first time a new place appears
 * on either map the user waits ~1.1 s per uncached place. Backfilling once
 * means subsequent map loads are instant.
 *
 * Usage:
 *   node scripts/backfill_state_places_coords.js          # dry-run summary
 *   node scripts/backfill_state_places_coords.js --apply  # actually geocode + write
 *
 * Requirements:
 *   .env.local with NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
 *
 * Safety: idempotent — rows that already have coords are skipped, so the script
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

// Nominatim's policy caps requests at 1/sec; 1.1 s gives headroom and matches
// the existing on-demand pipeline so behaviour is consistent.
const NOMINATIM_GAP_MS = 1100;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function geocode(place, state) {
  const query = `${place}, ${state}, Australia`;
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
  const { data: rows, error } = await supabase
    .from('state_places')
    .select('id, state, place, latitude, longitude')
    .or('latitude.is.null,longitude.is.null')
    .order('state', { ascending: true })
    .order('place', { ascending: true });

  if (error) {
    console.error('Failed to query state_places:', error.message, error.code, error.details);
    process.exit(1);
  }

  console.log(`Found ${rows.length} state_places rows missing coordinates.`);
  if (rows.length === 0) {
    console.log('Nothing to do.');
    return;
  }

  if (!apply) {
    console.log('\nDry run — pass --apply to geocode and write. First 20:');
    rows.slice(0, 20).forEach((r) => console.log(`  ${r.state} :: ${r.place}`));
    if (rows.length > 20) console.log(`  …and ${rows.length - 20} more.`);
    const estSec = Math.ceil((rows.length * NOMINATIM_GAP_MS) / 1000);
    console.log(`\nEstimated run time at 1 req/${NOMINATIM_GAP_MS}ms: ~${estSec}s (${(estSec / 60).toFixed(1)} min).`);
    return;
  }

  console.log('Applying — geocoding now…\n');
  let ok = 0;
  let failed = 0;
  const failures = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    // Space out lookups to respect Nominatim's 1/sec policy.
    if (i > 0) await sleep(NOMINATIM_GAP_MS);

    const result = await geocode(row.place, row.state);
    if (result.error) {
      failed++;
      failures.push({ state: row.state, place: row.place, reason: result.error });
      console.log(`  [${i + 1}/${rows.length}] ✗ ${row.state} :: ${row.place} — ${result.error}`);
      continue;
    }

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
      console.log(`  [${i + 1}/${rows.length}] ✓ ${row.state} :: ${row.place} → ${result.latitude.toFixed(4)}, ${result.longitude.toFixed(4)}`);
    }
  }

  console.log(`\nDone. Succeeded: ${ok}. Failed: ${failed}.`);
  if (failures.length > 0) {
    console.log('\nFailures (re-running the script will retry these):');
    failures.forEach((f) => console.log(`  - ${f.state} :: ${f.place} — ${f.reason}`));
  }
})();
