/**
 * One-off diagnostic — inspects the most recently-landed staging.ac_events
 * rows' raw AC payload to see what timestamp AC itself reports for the
 * contact (its own `cdate`/`udate`-style fields), as a way to gauge how
 * "fresh" the post-reload ac-sync catch-up actually is. Not part of the
 * app.
 */
import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';

const envPath = path.join(__dirname, '..', '.env.local');
fs.readFileSync(envPath, 'utf-8').split('\n').forEach((line) => {
  const t = line.trim();
  if (!t || t.startsWith('#')) return;
  const [k, ...rest] = t.split('=');
  if (k && rest.length) process.env[k.trim()] = rest.join('=').trim().replace(/^["']|["']$/g, '');
});

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

async function main() {
  const { data, error } = await supabase
    .schema('staging')
    .from('ac_events')
    .select('id, ac_contact_id, received_at, raw_payload')
    .order('id', { ascending: false })
    .limit(5);
  if (error) throw error;
  for (const row of data ?? []) {
    const contact = (row.raw_payload as { contact?: Record<string, unknown> })?.contact ?? row.raw_payload;
    console.log({
      id: row.id,
      ac_contact_id: row.ac_contact_id,
      received_at: row.received_at,
      contact_cdate: (contact as Record<string, unknown>)?.cdate,
      contact_udate: (contact as Record<string, unknown>)?.udate,
      contact_keys: Object.keys(contact as object),
    });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
