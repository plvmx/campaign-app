/**
 * One-off backup — dumps registry.registrants and
 * registry.registration_events to local JSON files before the CSV reload
 * truncates and replaces both. Neither table has any existing coverage in
 * lib/services/backupService.ts's BACKUP_TABLE_CONFIG (that system is for
 * the main app's public-schema tables only), so this is the only copy
 * that will exist once the reload runs.
 *
 * Confirmed live 2026-09-07: 9,134 registrants, 36,498 registration_events
 * — expect output files of a similar size.
 *
 * Usage:
 *   npx tsx scripts/backup_registrants_before_reload.ts
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

const PAGE_SIZE = 1000;
const OUT_DIR = path.join(__dirname, '..', 'backups');

async function dumpTable(table: string): Promise<unknown[]> {
  const rows: unknown[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await supabase
      .schema('registry')
      .from(table)
      .select('*')
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < PAGE_SIZE) break;
  }
  return rows;
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');

  for (const table of ['registrants', 'registration_events']) {
    console.log(`Dumping registry.${table}...`);
    const rows = await dumpTable(table);
    const outPath = path.join(OUT_DIR, `${table}_${stamp}.json`);
    fs.writeFileSync(outPath, JSON.stringify(rows, null, 2));
    console.log(`  ${rows.length} rows -> ${outPath}`);
  }

  console.log('\nDone. Keep these files somewhere safe outside the repo before proceeding — backups/ is gitignored, but this is still the only copy.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
