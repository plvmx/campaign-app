/** One-off read-only diagnostic. Not part of the app. */
import fs from 'fs'; import path from 'path'; import { createClient } from '@supabase/supabase-js';
fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf-8').split('\n').forEach((l) => { const t = l.trim(); if (!t || t.startsWith('#')) return; const [k, ...r] = t.split('='); if (k && r.length) process.env[k.trim()] = r.join('=').trim().replace(/^["']|["']$/g, ''); });
const reg = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } }).schema('registry');
(async () => {
  const o: any[] = []; for (let f = 0; ; f += 1000) { const { data } = await reg.from('registrants').select('email,ac_contact_id,first_seen_at').order('id').range(f, f + 999); o.push(...data!); if (data!.length < 1000) break; }
  const withSpace = o.filter(r => r.email && /\s/.test(r.email));
  const bad = o.filter(r => r.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r.email));
  console.log('registrants', o.length, '| email contains whitespace', withSpace.length, '| email not a valid address', bad.length, '| no email', o.filter(r => !r.email).length);
  console.log(withSpace.slice(0, 5).map(r => JSON.stringify(r.email)));
})();
