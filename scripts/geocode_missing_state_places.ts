/**
 * One-off repair (2026-10-29): places added from the Campaign Report screens
 * before they used lib/services/newStatePlace.ts landed in `state_places`
 * with no `location` text and no coordinates, so they were invisible on the
 * public maps and showed as ungeocoded in /admin/state-places.
 *
 * For every state_places row missing `location` and/or coordinates this sets
 * `location` to the place name (when empty) and geocodes it with the same
 * rules as new places: a result outside the place's own state is rejected
 * rather than stored. Only empty fields are filled; existing values are never
 * touched. Rows that can't be geocoded keep their `location` text so they can
 * be fixed from /admin/state-places.
 *
 * Nominatim allows 1 request/second, so this paces itself.
 *
 *   npx tsx scripts/geocode_missing_state_places.ts           # dry run
 *   npx tsx scripts/geocode_missing_state_places.ts --apply   # write
 */
import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import { buildNewStatePlaceRow } from '../lib/services/newStatePlace';

fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf-8').split('\n').forEach((line) => {
  const t = line.trim();
  if (!t || t.startsWith('#')) return;
  const [k, ...rest] = t.split('=');
  if (k && rest.length) process.env[k.trim()] = rest.join('=').trim().replace(/^["']|["']$/g, '');
});

const apply = process.argv.includes('--apply');
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface PlaceRow { id: string; state: string; place: string; location: string | null; latitude: number | null; longitude: number | null }

async function main() {
  const { data, error } = await supabase.from('state_places').select('id, state, place, location, latitude, longitude');
  if (error) throw error;
  const rows = (data as PlaceRow[]).filter((p) => !p.location?.trim() || p.latitude == null || p.longitude == null);
  console.log(`${apply ? 'APPLYING' : 'DRY RUN'} — ${rows.length} place(s) missing a location and/or coordinates\n`);

  let geocoded = 0;
  let locationOnly = 0;
  for (const p of rows) {
    const built = await buildNewStatePlaceRow(p.state, p.place);
    const update: Record<string, unknown> = {};
    if (!p.location?.trim()) update.location = built.location;
    if ((p.latitude == null || p.longitude == null) && built.latitude != null && built.longitude != null) {
      update.latitude = built.latitude;
      update.longitude = built.longitude;
    }
    const gotCoords = 'latitude' in update;
    gotCoords ? geocoded++ : locationOnly++;
    console.log(`${p.state.padEnd(4)} ${p.place.padEnd(26)} ${gotCoords ? `-> ${built.latitude?.toFixed(4)}, ${built.longitude?.toFixed(4)}` : '-> NOT GEOCODED (location text only)'}`);
    if (apply && Object.keys(update).length) {
      const { error: uErr } = await supabase.from('state_places').update(update).eq('id', p.id);
      if (uErr) console.error(`  FAILED: ${uErr.message}`);
    }
    await sleep(1100);
  }
  console.log(`\n${geocoded} geocoded, ${locationOnly} left without coordinates.${apply ? '' : ' Re-run with --apply to write.'}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
