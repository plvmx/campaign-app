/**
 * One-off — fixes registry.state_places' Knoxfield, VIC row (id
 * 20f912c2-ac95-4ca6-b415-bd450c5e0300), which had no `location` set and
 * so was never geocoded, silently excluding it from the public Campaigns
 * Near Me map's coordinate cache (that map only ever uses cached
 * state_places coordinates — see lib/services/publicCampaignsNearMeService.ts).
 * Reported by Peter 2026-09-17: the Knoxfield, 10:30am Sat 19 Sept
 * campaign was missing from Esther's map ("1 place could not be shown").
 *
 * Sets location = 'Knoxfield' (a real, directly geocodable Melbourne
 * suburb — unlike a venue/event name) and geocodes it the same way
 * app/api/admin/geocode-place/route.ts would. Not part of the app.
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

const ROW_ID = '20f912c2-ac95-4ca6-b415-bd450c5e0300';

async function main() {
  const geocoded = await geocodePlace('Knoxfield', 'VIC');
  if (!geocoded) {
    console.error('Nominatim returned no result for Knoxfield, VIC — nothing updated.');
    process.exit(1);
  }
  console.log('Geocoded to:', geocoded);

  const { error } = await supabase
    .from('state_places')
    .update({ location: 'Knoxfield', latitude: geocoded.latitude, longitude: geocoded.longitude })
    .eq('id', ROW_ID);
  if (error) throw error;

  console.log(`Updated state_places row ${ROW_ID} (VIC :: Knoxfield) with location + coordinates.`);
}

main().catch((err) => { console.error(err); process.exit(1); });
