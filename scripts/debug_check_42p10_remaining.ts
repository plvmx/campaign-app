/**
 * One-off diagnostic — checks whether any staging.ac_events rows still
 * carry the pre-fix 42P10 partial-index error unprocessed, after
 * fix_registrants_email_unique_index.sql was applied (see
 * docs/registry-pipeline/OPERATIONS.md). Not part of the app.
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
  const { data, error, count } = await supabase
    .schema('staging')
    .from('ac_events')
    .select('id, ac_contact_id, received_at, processing_error', { count: 'exact' })
    .ilike('processing_error', '%42P10%')
    .is('processed_at', null);
  if (error) throw error;
  console.log('Remaining unprocessed 42P10 rows:', count);
  console.log(JSON.stringify(data, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
