/** One-off read-only diagnostic. Not part of the app. */
import fs from 'fs'; import path from 'path'; import { createClient } from '@supabase/supabase-js';
fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf-8').split('\n').forEach((l) => { const t = l.trim(); if (!t || t.startsWith('#')) return; const [k, ...r] = t.split('='); if (k && r.length) process.env[k.trim()] = r.join('=').trim().replace(/^["']|["']$/g, ''); });
const reg = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } }).schema('registry');
(async () => {
  const db: any[] = []; for (let f = 0; ; f += 1000) { const { data } = await reg.from('registrants').select('first_name,last_name,email,phone,registered_at,first_seen_at').range(f, f + 999); db.push(...data!); if (data!.length < 1000) break; }
  const n = (a: string, b: string) => `${a || ''} ${b || ''}`.toLowerCase().replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim();
  const byLast = new Map<string, any[]>(); db.forEach(r => { const k = (r.last_name || '').toLowerCase().replace(/[^a-z]/g, ''); byLast.set(k, [...(byLast.get(k) || []), r]); });
  const absent: any[] = JSON.parse(fs.readFileSync(process.argv[2], 'utf-8'));
  let truly = 0;
  for (const a of absent) {
    const last = (a.lastName || '').toLowerCase().replace(/[^a-z]/g, '').trim();
    const c = (byLast.get(last) || []).filter(r => (r.first_name || '').toLowerCase().slice(0, 3) === (a.firstName || '').toLowerCase().trim().slice(0, 3));
    if (c.length) console.log('NAME MATCH', a.lineNumber, a.firstName, a.lastName, '=>', c.map(r => `${r.first_name} ${r.last_name} <${r.email}> ${r.phone}`).join('; '));
    else truly++;
  }
  console.log('truly absent (no name match either):', truly, 'of', absent.length);
})();
