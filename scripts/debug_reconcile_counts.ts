/** One-off read-only reconciliation: sheet rows vs registry after the planned fix. Not part of the app. */
import fs from 'fs'; import path from 'path'; import { createClient } from '@supabase/supabase-js';
import { planSheetRestore, sheetRowToRaw, phoneKey, toRegistrantInsertRow } from '../lib/registryPipeline/sheetRestorePlan';
import { transformRow } from '../lib/registryPipeline/csvRegistrantTransform';
fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf-8').split('\n').forEach((l) => { const t = l.trim(); if (!t || t.startsWith('#')) return; const [k, ...r] = t.split('='); if (k && r.length) process.env[k.trim()] = r.join('=').trim().replace(/^["']|["']$/g, ''); });
const reg = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } }).schema('registry');
async function all(t: string, c: string) { const o: any[] = []; for (let f = 0; ; f += 1000) { const { data } = await reg.from(t).select(c).order('id').range(f, f + 999); o.push(...data!); if (data!.length < 1000) break; } return o; }
const nk = (a: any, b: any) => `${a ?? ''} ${b ?? ''}`.toLowerCase().replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim();
(async () => {
  const sheet: any[] = JSON.parse(fs.readFileSync(process.argv[2], 'utf-8'));
  const db = await all('registrants', 'id,first_name,last_name,email,phone,first_seen_at');
  const twol = await all('twol_respondents', 'first_name,last_name,email,phone');
  const plan = planSheetRestore(sheet, db, twol);
  const finalPeople = [...db.map(r => ({ ...r, src: 'db' })), ...plan.inserts.map((i, n) => { const r = toRegistrantInsertRow(i.registrant); return { id: 'new' + n, first_name: r.first_name, last_name: r.last_name, email: r.email, phone: r.phone, first_seen_at: '9999', src: i.kind }; })];
  console.log('registry after fix:', finalPeople.length);
  const byEmail = new Map<string, any>(), byPhone = new Map<string, any[]>(), byName = new Map<string, any[]>();
  for (const p of finalPeople) { if (p.email) byEmail.set(p.email.toLowerCase(), p); const k = phoneKey(p.phone); if (k) byPhone.set(k, [...(byPhone.get(k) || []), p]); const n = nk(p.first_name, p.last_name); byName.set(n, [...(byName.get(n) || []), p]); }
  const fate: Record<string, number> = {}; const matched = new Map<string, number>();
  const bump = (k: string) => (fate[k] = (fate[k] || 0) + 1);
  let nonEmpty = 0;
  for (const row of sheet) {
    if (!(row.firstName.trim() || row.lastName.trim() || row.email.trim() || row.phone.trim())) continue;
    nonEmpty++;
    if (row.email.trim() === 'Email Address') { bump('header row'); continue; }
    const t = transformRow(sheetRowToRaw(row));
    if (t.status === 'excluded_non_au_state') { bump('overseas (OS/NZ/UK) — excluded by design'); continue; }
    const e = (row.email || '').trim().toLowerCase().replace(/\s+\d+$/, '').replace(/\s+/g, '');
    let p = e ? byEmail.get(e) : undefined;
    if (!p) { const ph = phoneKey(row.phone); const c = (ph && byPhone.get(ph)) || []; p = c.find((x: any) => nk(x.last_name, '') === nk(row.lastName, '') || (x.first_name || '').slice(0, 3).toLowerCase() === (row.firstName || '').trim().slice(0, 3).toLowerCase()) || undefined; }
    if (!p) { const c = byName.get(nk(row.firstName, row.lastName)); if (c?.length) p = c[0]; }
    if (!p) { bump('sheet row with no registry match (should be 0)'); continue; }
    matched.set(p.id, (matched.get(p.id) || 0) + 1); bump('matched to a registry person');
  }
  console.log('sheet non-empty rows', nonEmpty); console.log(fate);
  const distinct = matched.size; const collapsed = [...matched.values()].reduce((a, b) => a + b, 0) - distinct;
  console.log('distinct registry people matched by the sheet:', distinct, '| extra sheet rows collapsing onto the same person:', collapsed);
  const unmatched = finalPeople.filter(p => !matched.has(p.id));
  const newSince = unmatched.filter(p => p.first_seen_at >= '2026-09-24' && p.first_seen_at !== '9999');
  console.log('registry people with NO sheet row:', unmatched.length, '| of which first seen after 24 Sept:', newSince.length, '| older:', unmatched.length - newSince.length);
  const older = unmatched.filter(p => !(p.first_seen_at >= '2026-09-24'));
  const bySrc: Record<string, number> = {}; older.forEach(p => { const k = p.first_seen_at.slice(0, 10) <= '2026-09-10' ? 'first seen on/before 10 Sept (CSV reload era)' : 'first seen 10–24 Sept (ac-sync)'; bySrc[k] = (bySrc[k] || 0) + 1; }); console.log(bySrc);
  console.log('sample older unmatched:', older.slice(0, 8).map(p => `${p.first_name} ${p.last_name} <${p.email}> ${p.first_seen_at.slice(0,10)}`));
})();
