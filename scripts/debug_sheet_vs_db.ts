/** One-off read-only diagnostic: Lorraine's 24 Sept sheet vs registry.registrants. Not part of the app. */
import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf-8').split('\n').forEach((line) => {
  const t = line.trim(); if (!t || t.startsWith('#')) return;
  const [k, ...rest] = t.split('='); if (k && rest.length) process.env[k.trim()] = rest.join('=').trim().replace(/^["']|["']$/g, '');
});
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const reg = sb.schema('registry');
const ph = (s: string) => { const d = (s || '').replace(/\D/g, ''); return d.length >= 9 ? d.slice(-9) : ''; };
const em = (s: string) => (s || '').trim().toLowerCase();
async function all(table: string, cols: string) {
  const out: any[] = []; for (let f = 0; ; f += 1000) { const { data, error } = await reg.from(table).select(cols).range(f, f + 999); if (error) throw error; out.push(...data!); if (data!.length < 1000) break; } return out;
}
async function main() {
  const sheet: any[] = JSON.parse(fs.readFileSync(process.argv[2], 'utf-8'));
  const rows = sheet.filter(r => r.firstName || r.lastName || r.email || r.phone);
  const db = await all('registrants', 'id,first_name,last_name,email,phone,registered_at');
  const tw = await all('twol_respondents', 'first_name,last_name,email,phone');
  const dbE = new Set(db.map(r => em(r.email)).filter(Boolean)); const dbP = new Set(db.map(r => ph(r.phone)).filter(Boolean));
  const twE = new Set(tw.map(r => em(r.email))); const twP = new Set(tw.map(r => ph(r.phone)));
  const sE = new Set(rows.map(r => em(r.email)).filter(Boolean)); const sP = new Set(rows.map(r => ph(r.phone)).filter(Boolean));
  console.log('sheet non-empty rows', rows.length, '| distinct emails', sE.size, '| distinct phones', sP.size, '| no email', rows.filter(r => !em(r.email)).length, '| no phone', rows.filter(r => !ph(r.phone)).length, '| neither', rows.filter(r => !em(r.email) && !ph(r.phone)).length);
  const cats: Record<string, any[]> = { matched: [], inTwol: [], absent: [], noContact: [] };
  for (const r of rows) {
    const e = em(r.email), p = ph(r.phone);
    if (!e && !p) cats.noContact.push(r);
    else if ((e && dbE.has(e)) || (p && dbP.has(p))) cats.matched.push(r);
    else if ((e && twE.has(e)) || (p && twP.has(p))) cats.inTwol.push(r);
    else cats.absent.push(r);
  }
  for (const k of Object.keys(cats)) console.log(k, cats[k].length);
  const show = (r: any) => `line ${r.lineNumber}: ${r.firstName} ${r.lastName} | ${r.email} | ${r.phone} | regd ${r.regd} | ${r.church}`;
  
  fs.writeFileSync(process.argv[2].replace('sheet.json','absent.json'), JSON.stringify(cats.absent.filter(r => !['OS','UK','NZ'].includes((r.state||'').toUpperCase())))); const st: Record<string, number> = {}; cats.absent.forEach(r => { const k = r.state || '(blank)'; st[k] = (st[k] || 0) + 1; }); console.log('ABSENT by sheet state', JSON.stringify(st));
  console.log('\n-- no email/phone (sample 15):'); cats.noContact.slice(0, 15).forEach(r => console.log(show(r)));
  // DB records not in sheet
  const dbNotInSheet = db.filter(r => !(sE.has(em(r.email)) || sP.has(ph(r.phone))));
  console.log('\nDB registrants not in sheet:', dbNotInSheet.length);
  console.log(JSON.stringify(dbNotInSheet.filter(r=>r.registered_at<'2026-09-24').slice(0,10).map(r=>[r.first_name,r.last_name,r.email,r.registered_at])));
  // how many sheet rows collapse together (shared email/phone)
  console.log('sheet rows sharing an email/phone with an earlier row:', rows.length - new Set(rows.map(r => em(r.email) || ('p' + ph(r.phone)) )).size);
}
main();
