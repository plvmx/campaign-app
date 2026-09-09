/**
 * One-off diagnostic — quick registrant count check during the post-reload
 * ac-sync catch-up (see docs/registry-pipeline/OPERATIONS.md). Not part of
 * the app.
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
  const { count: registrants } = await supabase
    .schema('registry')
    .from('registrants')
    .select('*', { count: 'exact', head: true });
  console.log('registry.registrants count:', registrants);

  const { count: pendingStaging } = await supabase
    .schema('staging')
    .from('ac_events')
    .select('*', { count: 'exact', head: true })
    .is('processed_at', null);
  console.log('staging.ac_events unprocessed count:', pendingStaging);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
