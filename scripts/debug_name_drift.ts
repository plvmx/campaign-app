/** One-off read-only audit: registrants whose stored name differs from what ActiveCampaign currently has. Not part of the app. */
import fs from 'fs'; import path from 'path'; import { createClient } from '@supabase/supabase-js';
fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf-8').split('\n').forEach((l) => { const t = l.trim(); if (!t || t.startsWith('#')) return; const [k, ...r] = t.split('='); if (k && r.length) process.env[k.trim()] = r.join('=').trim().replace(/^["']|["']$/g, ''); });
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const norm = (s: string | null) => (s ?? '').toLowerCase().replace(/[^a-z]/g, '');
(async () => {
  const db: any[] = []; for (let f = 0; ; f += 1000) { const { data } = await sb.schema('registry').from('registrants').select('id,email,ac_contact_id,first_name,last_name').not('ac_contact_id', 'is', null).order('id').range(f, f + 999); db.push(...data!); if (data!.length < 1000) break; }
  const latest = new Map<string, any>();
  for (let i = 0; i < db.length; i += 100) {
    const ids = db.slice(i, i + 100).map(r => r.ac_contact_id);
    const { data } = await sb.schema('staging').from('ac_events').select('ac_contact_id,fn:raw_payload->contact->>firstName,ln:raw_payload->contact->>lastName').in('ac_contact_id', ids).order('id');
    (data ?? []).forEach((e: any) => latest.set(e.ac_contact_id, e));
  }
  const diffs = db.filter(r => { const a = latest.get(r.ac_contact_id); return a && (norm(a.fn) !== norm(r.first_name) || norm(a.ln) !== norm(r.last_name)); });
  console.log('synced registrants', db.length, '| stored name differs from latest AC name:', diffs.length);
  const kind = { prefixOrTypo: 0, other: 0 };
  diffs.forEach(r => { const a = latest.get(r.ac_contact_id); const same = (x: string, y: string) => x === y || x.startsWith(y) || y.startsWith(x); (same(norm(a.fn), norm(r.first_name)) && same(norm(a.ln), norm(r.last_name))) ? kind.prefixOrTypo++ : kind.other++; });
  console.log(kind);
  diffs.slice(0, 25).forEach(r => { const a = latest.get(r.ac_contact_id); console.log(`${r.first_name} ${r.last_name}  ->  AC: ${a.fn} ${a.ln}`); });
})();
