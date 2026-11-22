/** One-off read-only check: the registration-log outcome rules against live data. Not part of the app. */
import fs from 'fs'; import path from 'path'; import { createClient } from '@supabase/supabase-js';
import { deriveRegistrationOutcome } from '../lib/registryPipeline/registrationLog';
fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf-8').split('\n').forEach((l) => { const t = l.trim(); if (!t || t.startsWith('#')) return; const [k, ...r] = t.split('='); if (k && r.length) process.env[k.trim()] = r.join('=').trim().replace(/^["']|["']$/g, ''); });
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
(async () => {
  const { data } = await sb.schema('staging').from('ac_events').select('id,source_list_id,processed_at,processing_error,email:raw_payload->contact->>email').gte('id', 64092).order('id', { ascending: false });
  const ids = data!.map((e: any) => e.id);
  const ev = await sb.schema('registry').from('registration_events').select('raw_staging_id,registrant_id').in('raw_staging_id', ids);
  const tw = await sb.schema('registry').from('twol_respondents').select('raw_staging_id').in('raw_staging_id', ids);
  const rg = await sb.schema('registry').from('registrants').select('id,first_seen_at').in('id', [...new Set(ev.data!.map((e: any) => e.registrant_id))]);
  const byEv = new Map(ev.data!.map((e: any) => [e.raw_staging_id, e.registrant_id])); const tws = new Set(tw.data!.map((e: any) => e.raw_staging_id)); const rmap = new Map(rg.data!.map((r: any) => [r.id, r]));
  for (const e of data! as any[]) { const r: any = rmap.get(byEv.get(e.id)); console.log(e.id, e.source_list_id, e.email, '=>', deriveRegistrationOutcome({ processedAt: e.processed_at, processingError: e.processing_error, hasResponderRow: tws.has(e.id), registrant: r ? { firstSeenAt: r.first_seen_at } : null })); }
})();
