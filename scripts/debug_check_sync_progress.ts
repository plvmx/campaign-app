/**
 * One-off diagnostic — checks registry.sync_progress's current offset
 * (pagination position within the ID-ascending /contacts sweep) and, if
 * AC credentials are available, the total contact count AC reports for
 * the same filters[updated_after] cutoff, to gauge how far through the
 * post-reload catch-up ac-sync actually is. Not part of the app.
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
    .from('sync_progress')
    .select('*');
  if (error) throw error;
  console.log('registry.sync_progress:', JSON.stringify(data, null, 2));

  const baseUrl = process.env.AC_API_BASE_URL;
  const apiKey = process.env.AC_API_KEY;
  if (!baseUrl || !apiKey) {
    console.log('\nAC_API_BASE_URL/AC_API_KEY not set locally — skipping AC total-count check.');
    return;
  }

  const cutoff = '2026-08-22T00:00:00Z';
  const url = `${baseUrl}/contacts?orders[id]=ASC&limit=1&offset=0&filters[updated_after]=${encodeURIComponent(cutoff)}`;
  const resp = await fetch(url, { headers: { 'Api-Token': apiKey } });
  const body = await resp.json();
  console.log(`\nAC total contacts matching updated_after=${cutoff}:`, body?.meta?.total ?? '(no meta.total in response)', JSON.stringify(body?.meta));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
