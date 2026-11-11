/** One-off read-only diagnostic (registrant count drift). Not part of the app. */
import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf-8').split('\n').forEach((line) => {
  const t = line.trim(); if (!t || t.startsWith('#')) return;
  const [k, ...rest] = t.split('='); if (k && rest.length) process.env[k.trim()] = rest.join('=').trim().replace(/^["']|["']$/g, '');
});
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const reg = sb.schema('registry');
async function main() {
  const total = await reg.from('registrants').select('*', { count: 'exact', head: true });
  console.log('registrants exact count:', total.count);
  const since = await reg.from('registrants').select('*', { count: 'exact', head: true }).gte('first_seen_at', '2026-09-24T00:00:00Z');
  console.log('first_seen_at >= 2026-09-24:', since.count);
  const since2 = await reg.from('registrants').select('*', { count: 'exact', head: true }).gte('registered_at', '2026-09-24T00:00:00Z');
  console.log('registered_at >= 2026-09-24:', since2.count);
  const tw = await reg.from('twol_respondents').select('*', { count: 'exact', head: true });
  console.log('twol_respondents rows:', tw.count);
  const log = await reg.from('sync_log').select('*').order('id', { ascending: false }).limit(3);
  console.log(JSON.stringify(log.data, null, 1));
  // new registrants per day since 9/24
  const rows: any[] = [];
  for (let f = 0; ; f += 1000) { const { data } = await reg.from('registrants').select('first_seen_at,registered_at').gte('first_seen_at', '2026-09-20T00:00:00Z').order('first_seen_at').range(f, f + 999); rows.push(...data!); if (data!.length < 1000) break; }
  const byDay: Record<string, number> = {}; rows.forEach(r => { const d = r.first_seen_at.slice(0, 10); byDay[d] = (byDay[d] || 0) + 1; });
  console.log('first_seen_at per day:', byDay);
}
main();
async function more() {
  const rows: any[] = [];
  for (let f = 0; ; f += 1000) { const { data } = await reg.from('registrants').select('first_seen_at,last_updated_at,ac_contact_id,unsubscribed,nfc').order('id').range(f, f + 999); rows.push(...data!); if (data!.length < 1000) break; }
  const n = (p: (r: any) => boolean) => rows.filter(p).length;
  console.log('total', rows.length, '| first_seen<=2026-09-09T13:00', n(r => r.first_seen_at <= '2026-09-09T13:00'), '| between 09-09 and 09-24', n(r => r.first_seen_at > '2026-09-09T13:00' && r.first_seen_at < '2026-09-24'), '| after 09-24', n(r => r.first_seen_at >= '2026-09-24'));
  console.log('unsub Yes', n(r => r.unsubscribed === 'Yes'), 'nfc Yes', n(r => r.nfc === 'Yes'), 'null ac id', n(r => !r.ac_contact_id));
  const e = await reg.from('registrant_edits').select('*', { count: 'exact', head: true }); console.log('edits', e.count);
  const dup = await reg.from('registrants').select('email').limit(0);
}
more();
async function paging() {
  for (let run = 0; run < 3; run++) {
    const ids: string[] = [];
    for (let f = 0; ; f += 1000) { const { data } = await reg.from('registrants').select('id').range(f, f + 999); ids.push(...data!.map((r: any) => r.id)); if (data!.length < 1000) break; }
    console.log('unordered paging run', run, 'rows', ids.length, 'distinct', new Set(ids).size);
  }
  const tw = await reg.from('twol_respondents').select('created_at'); const c: Record<string, number> = {};
  tw.data!.forEach((r: any) => { const d = r.created_at.slice(0, 10); c[d] = (c[d] || 0) + 1; }); console.log('twol created per day', c);
  const ev = await reg.from('registration_events').select('*', { count: 'exact', head: true }); console.log('registration_events', ev.count);
}
paging();
