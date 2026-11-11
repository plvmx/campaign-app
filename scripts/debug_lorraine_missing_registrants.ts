/** One-off read-only diagnostic (Lorraine's re-registered people). Not part of the app. */
import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';

fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf-8').split('\n').forEach((line) => {
  const t = line.trim();
  if (!t || t.startsWith('#')) return;
  const [k, ...rest] = t.split('=');
  if (k && rest.length) process.env[k.trim()] = rest.join('=').trim().replace(/^["']|["']$/g, '');
});
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function main() {
  for (const id of ['10943', '6609']) {
    const s = await sb.schema('staging').from('ac_events').select('id,source_list_id,event_type,received_at,processed_at,processing_error,raw_payload').eq('ac_contact_id', id).order('id');
    console.log(`\n=== AC contact ${id}: ${s.data?.length} events`, s.error?.message ?? '');
    for (const e of s.data ?? []) {
      const c = (e.raw_payload as any)?.contact ?? e.raw_payload;
      console.log(e.id, 'list', e.source_list_id, e.event_type, 'recv', e.received_at, 'proc', e.processed_at, 'err', e.processing_error, '| email', c?.email, '| tags', JSON.stringify((e.raw_payload as any)?.tags ?? (e.raw_payload as any)?.contactTags)?.slice(0, 200));
    }
    const ev = await sb.schema('registry').from('registration_events').select('*').eq('raw_staging_id', 0);
    void ev;
  }
  const re = await sb.schema('registry').from('registration_events').select('*').in('registrant_id', ['ab126d23-bd74-492b-ae49-17fa76387054']);
  console.log('\nregistration_events for Testing Cottam row:', JSON.stringify(re.data, null, 1), re.error?.message ?? '');
  const ed = await sb.schema('registry').from('registrant_edits').select('*').eq('registrant_id', 'ab126d23-bd74-492b-ae49-17fa76387054');
  console.log('edits:', JSON.stringify(ed.data, null, 1));
  const em = await sb.schema('registry').from('registrants').select('id,first_name,last_name,email,phone,registered_at,nfc,last_updated_at').or('email.ilike.%yen_col%,email.ilike.%chris.tutauha%,first_name.ilike.yency%,nfc.eq.Yes');
  console.log('lookup', JSON.stringify(em.data?.filter((r:any)=>r.email?.includes('yen_col')||r.email?.includes('tutauha')||r.first_name?.toLowerCase().startsWith('yency')), null, 1));
  const nfcRecent = await sb.schema('registry').from('registrant_edits').select('*').gte('edited_at','2026-10-15').order('edited_at');
  console.log('recent edits since 10-15:', JSON.stringify(nfcRecent.data, null, 1), nfcRecent.error?.message ?? '');
}
main();
