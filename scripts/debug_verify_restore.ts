/** One-off read-only verification. Not part of the app. */
import fs from 'fs'; import path from 'path'; import { createClient } from '@supabase/supabase-js';
fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf-8').split('\n').forEach((l) => { const t = l.trim(); if (!t || t.startsWith('#')) return; const [k, ...r] = t.split('='); if (k && r.length) process.env[k.trim()] = r.join('=').trim().replace(/^["']|["']$/g, ''); });
const reg = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } }).schema('registry');
(async () => {
  const c = await reg.from('registrants').select('*', { count: 'exact', head: true }); console.log('total', c.count);
  const a = await reg.from('registrants').select('first_name,last_name,email,phone,state,postcode,registered_at,webinar_session_at,unsubscribed,nfc,ac_contact_id').or('last_name.ilike.tutauha%,last_name.ilike.mahecha%'); console.log(a.data);
  const e = await reg.from('registrant_edits').select('field,old_value,new_value,edited_by_email').order('id', { ascending: false }).limit(2); console.log(e.data);
  const t = await reg.from('twol_respondents').select('*', { count: 'exact', head: true }); console.log('twol rows (untouched)', t.count);
  const u = await reg.from('registrants').select('*', { count: 'exact', head: true }).eq('unsubscribed', 'Yes'); const n = await reg.from('registrants').select('*', { count: 'exact', head: true }).eq('nfc', 'Yes'); console.log('unsub', u.count, 'nfc', n.count);
})();
