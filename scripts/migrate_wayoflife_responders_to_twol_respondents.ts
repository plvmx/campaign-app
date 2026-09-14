/**
 * One-off migration — moves registry.registrants rows that were incorrectly
 * created from AC List [2] (/wayoflife-responder/) submissions into the new
 * registry.twol_respondents table, and removes them from registrants.
 *
 * Background: before lib/registryPipeline/transform.ts was fixed
 * (2026-09-14) to route List [2] events to twol_respondents directly,
 * every ac-sync run since the CSV reload (2026-09-08/09) upserted these
 * third-party-submitted "someone a TWOL presenter reported presenting to"
 * contacts straight into registrants, same as a genuine self-registration.
 * See scripts/create_registry_twol_respondents_table.sql's header for the
 * full root-cause writeup.
 *
 * Scope, deliberately narrow: only registrants whose registration_events
 * are List [2] ONLY (never List [1] or any other list) are moved. A
 * registrant who ALSO has a genuine List-1 event stays put — they really
 * did register themselves at some point (via /register/, /thewayoflife/,
 * or the BOTJ webinar); being separately reported via the responder form
 * too doesn't change that, same precedent as tagExclusion.ts's "a contact
 * who was originally MailChimp-imported but later also genuinely
 * registered keeps that legitimate attribution" rule.
 *
 * CSV-reloaded rows (ac_contact_id IS NULL) are automatically out of
 * scope: they have zero registration_events (the reload never wrote any),
 * so they can never match "List [2] only" — confirmed live 2026-09-14.
 * This naturally satisfies "only records added after the CSV reload"
 * without needing a date cutoff.
 *
 * A registrant with multiple List-2 events (duplicate ac-sync re-syncs of
 * the same contact — a separate, known issue with registration_events
 * accumulating repeat rows) produces one twol_respondents row per event,
 * mirroring the one-row-per-submission shape the fixed live pipeline now
 * produces going forward.
 *
 * SAFETY:
 *  - Defaults to a dry run: prints a summary, writes nothing.
 *  - Always dumps the full set of affected registrants + their
 *    registration_events to backups/ (gitignored) before making any
 *    change, dry run or not — the only copy once --apply deletes them.
 *  - --apply inserts into twol_respondents, then deletes the affected
 *    registrants (registration_events cascade-delete with them).
 *  - Requires registry.twol_respondents to already exist — run
 *    scripts/create_registry_twol_respondents_table.sql in the Supabase
 *    SQL Editor first.
 *
 * Usage:
 *   npx tsx scripts/migrate_wayoflife_responders_to_twol_respondents.ts           # dry run
 *   npx tsx scripts/migrate_wayoflife_responders_to_twol_respondents.ts --apply   # actually migrate
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

const apply = process.argv.includes('--apply');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

const PAGE_SIZE = 1000;
const OUT_DIR = path.join(__dirname, '..', 'backups');

interface Registrant {
  id: string;
  ac_contact_id: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  phone_raw: string | null;
  state: string | null;
  registered_at: string | null;
}

interface RegistrationEvent {
  id: number;
  registrant_id: string;
  source_list_id: string;
  source_tag: string | null;
  raw_staging_id: number | null;
}

async function fetchAll<T>(table: string, columns: string): Promise<T[]> {
  const rows: T[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await supabase
      .schema('registry')
      .from(table)
      .select(columns)
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    rows.push(...(data as T[]));
    if (data.length < PAGE_SIZE) break;
  }
  return rows;
}

async function main() {
  console.log('Fetching registry.registration_events...');
  const events = await fetchAll<RegistrationEvent>(
    'registration_events',
    'id, registrant_id, source_list_id, source_tag, raw_staging_id',
  );
  console.log(`  ${events.length} events fetched.`);

  const eventsByRegistrant = new Map<string, RegistrationEvent[]>();
  for (const e of events) {
    const list = eventsByRegistrant.get(e.registrant_id) ?? [];
    list.push(e);
    eventsByRegistrant.set(e.registrant_id, list);
  }

  const onlyList2Ids = [...eventsByRegistrant.entries()]
    .filter(([, evs]) => evs.every((e) => e.source_list_id === '2'))
    .map(([id]) => id);

  console.log(`Registrants whose ONLY registration_events are List [2]: ${onlyList2Ids.length}`);

  if (onlyList2Ids.length === 0) {
    console.log('Nothing to migrate.');
    return;
  }

  console.log('Fetching those registrants...');
  const registrants: Registrant[] = [];
  for (let i = 0; i < onlyList2Ids.length; i += PAGE_SIZE) {
    const batch = onlyList2Ids.slice(i, i + PAGE_SIZE);
    const { data, error } = await supabase
      .schema('registry')
      .from('registrants')
      .select('id, ac_contact_id, first_name, last_name, email, phone, phone_raw, state, registered_at')
      .in('id', batch);
    if (error) throw error;
    registrants.push(...((data ?? []) as Registrant[]));
  }

  const affectedEvents = onlyList2Ids.flatMap((id) => eventsByRegistrant.get(id) ?? []);
  console.log(`  ${registrants.length} registrants, ${affectedEvents.length} registration_events total.`);

  // Backup — always, dry run or not. Only copy once --apply deletes these rows.
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(OUT_DIR, `wayoflife_responder_migration_${stamp}.json`);
  fs.writeFileSync(backupPath, JSON.stringify({ registrants, events: affectedEvents }, null, 2));
  console.log(`Backed up affected rows -> ${backupPath}`);

  const twolRows = registrants.flatMap((r) =>
    (eventsByRegistrant.get(r.id) ?? []).map((e) => ({
      ac_contact_id: r.ac_contact_id,
      first_name: r.first_name,
      last_name: r.last_name,
      email: r.email,
      phone: r.phone,
      phone_raw: r.phone_raw,
      state: r.state,
      registered_at: r.registered_at,
      source_tag: e.source_tag,
      raw_staging_id: e.raw_staging_id,
    })),
  );

  console.log(`\n${apply ? 'APPLYING' : 'DRY RUN'}: would insert ${twolRows.length} rows into registry.twol_respondents, then delete ${registrants.length} rows from registry.registrants (cascading ${affectedEvents.length} registration_events).`);

  if (!apply) {
    console.log('\nSample of registrants that would move:');
    for (const r of registrants.slice(0, 5)) {
      console.log(`  ${r.first_name ?? ''} ${r.last_name ?? ''} <${r.email ?? 'no email'}> ${r.state ?? ''}`);
    }
    console.log('\nRe-run with --apply to actually migrate.');
    return;
  }

  console.log('\nInserting into registry.twol_respondents...');
  for (let i = 0; i < twolRows.length; i += PAGE_SIZE) {
    const batch = twolRows.slice(i, i + PAGE_SIZE);
    const { error } = await supabase.schema('registry').from('twol_respondents').insert(batch);
    if (error) throw error;
  }
  console.log(`  ${twolRows.length} rows inserted.`);

  console.log('Deleting migrated rows from registry.registrants (registration_events cascade)...');
  for (let i = 0; i < onlyList2Ids.length; i += PAGE_SIZE) {
    const batch = onlyList2Ids.slice(i, i + PAGE_SIZE);
    const { error } = await supabase.schema('registry').from('registrants').delete().in('id', batch);
    if (error) throw error;
  }
  console.log(`  ${onlyList2Ids.length} registrants deleted.`);

  console.log('\nDone.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
