/** One-off read-only diagnostic. Not part of the app. */
import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf-8').split('\n').forEach((line) => {
  const t = line.trim(); if (!t || t.startsWith('#')) return;
  const [k, ...rest] = t.split('='); if (k && rest.length) process.env[k.trim()] = rest.join('=').trim().replace(/^["']|["']$/g, '');
});
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
async function all(table: string, cols: string) {
  const out: any[] = []; for (let f = 0; ; f += 1000) {
    const { data, error } = await sb.schema('registry').from(table).select(cols).range(f, f + 999);
    if (error) throw error; out.push(...data!); if (data!.length < 1000) break;
  } return out;
}
async function main() {
  const csv = fs.readFileSync('/home/peterv/Documents/AFJ Registrations.csv', 'utf-8').split('\n').map(l => l.split(','));
  const csvEmails = new Set(csv.map(r => (r[2] || '').trim().toLowerCase()).filter(e => e.includes('@')));
  const reg = await all('registrants', 'email'); const regSet = new Set(reg.map(r => (r.email || '').toLowerCase()));
  const twol = await all('twol_respondents', 'email,first_name,last_name,created_at,registered_at');
  const seen = new Set<string>(); const hits: any[] = [];
  for (const t of twol) { const e = (t.email || '').toLowerCase(); if (seen.has(e)) continue; seen.add(e);
    if (csvEmails.has(e) && !regSet.has(e) && e !== 'noemail@noemail.com') hits.push(t); }
  console.log('twol distinct emails:', seen.size, '| in Lorraine CSV but NOT in registrants:', hits.length);
  hits.forEach(h => console.log(h.first_name, h.last_name, h.email, 'created', h.created_at));
  const noemail = reg.filter(r => (r.email||'').toLowerCase()==='noemail@noemail.com').length;
  console.log('registrants with noemail@noemail.com:', noemail);
}
main();
