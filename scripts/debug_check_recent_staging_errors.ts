/**
 * One-off diagnostic — checks the most recent staging.ac_events rows
 * with a processing_error set, to see the actual error message behind
 * an ac-sync invocation's aggregate error count. Not part of the app.
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
    .select('id, ac_contact_id, received_at, processing_error')
    .not('processing_error', 'is', null)
    .order('received_at', { ascending: false })
    .limit(5);
  if (error) throw error;
  console.log(JSON.stringify(data, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
