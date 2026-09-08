/**
 * One-off diagnostic — checks current registry.registrants state before
 * planning the CSV reload. Not part of the app.
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
  const { count, error: countError } = await supabase
    .schema('registry')
    .from('registrants')
    .select('*', { count: 'exact', head: true });
  if (countError) throw countError;
  console.log('registry.registrants row count:', count);

  const { data: sample, error: sampleError } = await supabase
    .schema('registry')
    .from('registrants')
    .select('*')
    .limit(3);
  if (sampleError) throw sampleError;
  console.log('Sample rows:', JSON.stringify(sample, null, 2));

  const { count: eventsCount, error: eventsError } = await supabase
    .schema('registry')
    .from('registration_events')
    .select('*', { count: 'exact', head: true });
  if (eventsError) throw eventsError;
  console.log('registry.registration_events row count:', eventsCount);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
