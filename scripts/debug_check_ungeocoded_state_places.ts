/**
 * One-off diagnostic — Peter reported the Knoxfield, VIC campaign missing
 * from the public Campaigns Near Me map (fixed live via
 * fix_knoxfield_state_places_geocode.ts). Widened the check to see how
 * many other state_places rows have the same root cause: created without
 * a `location` value, so they were never geocoded and silently drop out
 * of every map that only uses cached coordinates (the public Campaigns
 * Near Me map never geocodes on demand — see
 * lib/services/publicCampaignsNearMeService.ts's own header comment).
 * Not part of the app.
 */
import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
const envPath = path.join(__dirname, '..', '.env.local');
fs.readFileSync(envPath, 'utf-8').split('\n').forEach((line) => {
  const t = line.trim();
  if (!t || t.startsWith('#')) return;
  const [k, ...rest] = t.split('=');
  if (k && rest.length) process.env[k.trim()] = rest.join('=').trim().replace(/^["']|["']$/g, '');
});
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });

(async () => {
  const { data, error } = await supabase.from('state_places').select('id, state, place, location, latitude, longitude, created_at').or('latitude.is.null,longitude.is.null').order('created_at', { ascending: true });
  if (error) throw error;
  console.log(`Rows with no coordinates: ${data?.length}`);
  console.log(JSON.stringify(data, null, 2));
})();
