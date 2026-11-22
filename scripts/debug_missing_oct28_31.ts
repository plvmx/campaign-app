/** One-off read-only diagnostic. Not part of the app. */
import fs from 'fs'; import path from 'path'; import { createClient } from '@supabase/supabase-js';
fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf-8').split('\n').forEach((l) => { const t = l.trim(); if (!t || t.startsWith('#')) return; const [k, ...r] = t.split('='); if (k && r.length) process.env[k.trim()] = r.join('=').trim().replace(/^["']|["']$/g, ''); });
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
(async () => {
  const r = await sb.schema('registry').from('registrants').select('*').ilike('email', 'mikmaloy@hotmail.com'); console.log(JSON.stringify(r.data, null, 1));
  const ev = await sb.schema('staging').from('ac_events').select('id,received_at,processed_at,processing_error,raw_payload').eq('ac_contact_id', '14443').order('id');
  for (const e of ev.data ?? []) { const p: any = e.raw_payload; console.log(e.id, e.received_at, e.processing_error, JSON.stringify({ contact: p.contact, fv: p.fieldValues, tags: p.tags?.map((t: any) => t.id + '@' + (t.cdate ?? '').slice(0, 19)), lm: p.listMembership })); }
  const re = await sb.schema('registry').from('registration_events').select('*').eq('registrant_id', r.data![0].id); console.log(re.data);
  const nm = await sb.schema('registry').from('registrants').select('first_name,last_name,email').ilike('last_name', 'parola%'); console.log(nm.data);
})();
