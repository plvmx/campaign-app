/**
 * One-off — geocodes the remaining straightforward state_places rows found
 * missing coordinates alongside Knoxfield (see
 * fix_knoxfield_state_places_geocode.ts / debug_check_ungeocoded_state_places.ts),
 * 2026-09-17. Each of these is a real, directly geocodable place — unlike
 * the two left alone:
 *   - 'Perth Metro' (WA) had location 'Anywhere', not a real point — per
 *     Peter, this should represent Perth CBD instead, so its location is
 *     corrected to 'Perth CBD' and geocoded from that (place name itself
 *     stays 'Perth Metro' — campaigns already reference that place name;
 *     only the geocode-source `location` text changes).
 *   - 'Kaikora, NZ' (state: QLD) is in New Zealand, filed under an
 *     Australian state — left for Peter to look at himself, not something
 *     to guess at.
 *
 * Two venue names ('Perth Royal Show', 'Booragoon Garden City') use a more
 * specific/reliable location string than the bare venue name, same
 * reasoning as the location-vs-place split PR #95 introduced generally.
 * Not part of the app.
 */
import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import { geocodePlace } from '../lib/geocoding';

const envPath = path.join(__dirname, '..', '.env.local');
fs.readFileSync(envPath, 'utf-8').split('\n').forEach((line) => {
  const t = line.trim();
  if (!t || t.startsWith('#')) return;
  const [k, ...rest] = t.split('=');
  if (k && rest.length) process.env[k.trim()] = rest.join('=').trim().replace(/^["']|["']$/g, '');
});

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

const FIXES: { id: string; place: string; state: string; location: string }[] = [
  { id: '81b73222-a4de-42e0-b25a-1c60100904f4', place: 'Brisbane CBD', state: 'QLD', location: 'Brisbane CBD' },
  { id: 'b4b8c79d-4d01-4d0e-844b-ad3669b6d991', place: 'Rivervale', state: 'WA', location: 'Rivervale' },
  { id: '6b9a98b2-0e70-41ee-a8af-096824be8eaf', place: 'Booragoon Garden City', state: 'WA', location: 'Garden City Shopping Centre, Booragoon' },
  { id: 'ff3adebe-046b-4684-9f8e-49cdaf68d606', place: 'Perth Royal Show', state: 'WA', location: 'Claremont Showgrounds' }, // singular 'Showground' returned no Nominatim match; plural does
  { id: '12104ea9-4fe9-46ee-9c71-4ef68c2153f5', place: 'Albury', state: 'NSW', location: 'Albury' },
  { id: '1995aa48-846b-483a-84b2-97e912b3b619', place: 'Griffith', state: 'NSW', location: 'Griffith' },
  { id: '0e91a951-32eb-4b9d-9bf9-98a462f74720', place: 'Perth Metro', state: 'WA', location: 'Perth CBD' },
];

async function main() {
  for (const fix of FIXES) {
    const geocoded = await geocodePlace(fix.location, fix.state);
    if (!geocoded) {
      console.log(`SKIP ${fix.state} :: ${fix.place} — Nominatim found nothing for "${fix.location}"`);
      continue;
    }
    const { error } = await supabase
      .from('state_places')
      .update({ location: fix.location, latitude: geocoded.latitude, longitude: geocoded.longitude })
      .eq('id', fix.id);
    if (error) throw error;
    console.log(`FIXED ${fix.state} :: ${fix.place} -> location "${fix.location}", (${geocoded.latitude}, ${geocoded.longitude})`);
    // Nominatim's usage policy caps requests at 1/sec.
    await new Promise((r) => setTimeout(r, 1100));
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
