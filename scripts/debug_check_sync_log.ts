/**
 * One-off diagnostic — checks registry.sync_log's recent history to see
 * what cursor ac-sync would actually use if invoked right now, following
 * the registrations CSV reload. Not part of the app.
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
    .schema('registry')
    .from('sync_log')
    .select('*')
    .order('started_at', { ascending: false })
    .limit(10);
  if (error) throw error;
  console.log('Last 10 sync_log rows:');
  console.log(JSON.stringify(data, null, 2));

  const { data: lastSuccess, error: e2 } = await supabase
    .schema('registry')
    .from('sync_log')
    .select('completed_at, started_at')
    .eq('run_type', 'sync')
    .eq('status', 'success')
    .order('completed_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (e2) throw e2;
  console.log('\nLast successful sync (the cursor ac-sync would actually use via getLastCompletedSyncTimestamp()):', lastSuccess);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
