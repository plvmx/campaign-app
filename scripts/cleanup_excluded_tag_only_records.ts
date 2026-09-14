/**
 * One-off cleanup — removes registry.registrants / registry.twol_respondents
 * rows that were created before lib/registryPipeline/tagExclusion.ts's
 * EXCLUDED_SOURCE_TAG_IDS was extended (2026-09-14) to cover:
 *
 *   [40]/[41]  "Mobilise - Make a Donation: Form completed" (+ FUNNEL companion)
 *   [8]/[9]    "FORM/FUNNEL: TWOL Explore More: Requested"
 *   [6]        "FORM: TWOL Video: Requested"
 *
 * (Tag [11] "SOURCE: Mail Chimp Upload" has been excluded since 2026-08-29
 * — well before the CSV reload — so no already-synced row can exist from
 * that one; it's included in the scan below purely as a sanity check that
 * this holds.)
 *
 * A contact is in scope if NONE of their staging.ac_events ever carried a
 * genuine registration-funnel tag ([1]/[21]/[48]/[58]) and AT LEAST ONE
 * carried one of the newly-excluded tags above — the same "excluded only
 * if it's their ONLY signal" rule tagExclusion.ts applies live, just
 * computed here across every historical event for that contact rather
 * than one event at a time.
 *
 * SAFETY:
 *  - Defaults to a dry run: prints a summary, deletes nothing.
 *  - Always backs up every affected row (from both tables) to backups/
 *    (gitignored) before any write, dry run or not.
 *  - --apply actually deletes. Deletes only — nothing is moved anywhere,
 *    matching tagExclusion.ts's "excluded from the registry" semantics
 *    (unlike scripts/migrate_wayoflife_responders_to_twol_respondents.ts,
 *    which moved wanted data to a new table).
 *
 * Usage:
 *   npx tsx scripts/cleanup_excluded_tag_only_records.ts           # dry run
 *   npx tsx scripts/cleanup_excluded_tag_only_records.ts --apply   # actually delete
 */
import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import { isExcludedSourceOnly } from '../lib/registryPipeline/tagExclusion';
import { matchSourceTag } from '../lib/registryPipeline/sourceAttribution';
import type { AcContactTag, KnownSourceTag } from '../lib/registryPipeline/types';

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

interface StagingRow {
  id: number;
  ac_contact_id: string | null;
  raw_payload: { tags: AcContactTag[] };
}

async function fetchAllStaging(): Promise<StagingRow[]> {
  const rows: StagingRow[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await supabase
      .schema('staging')
      .from('ac_events')
      .select('id, ac_contact_id, raw_payload')
      .range(offset, offset + PAGE_SIZE - 1)
      .order('id', { ascending: true });
    if (error) throw error;
    if (!data || data.length === 0) break;
    rows.push(...(data as StagingRow[]));
    if (data.length < PAGE_SIZE) break;
  }
  return rows;
}

async function fetchAll<T>(schema: string, table: string, columns: string): Promise<T[]> {
  const rows: T[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await supabase.schema(schema).from(table).select(columns).range(offset, offset + PAGE_SIZE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    rows.push(...(data as T[]));
    if (data.length < PAGE_SIZE) break;
  }
  return rows;
}

async function main() {
  console.log('Fetching registry.known_source_tags...');
  const knownTags = await fetchAll<KnownSourceTag>('registry', 'known_source_tags', '*');
  console.log(`  ${knownTags.length} known source tags.`);

  console.log('Fetching every staging.ac_events row (this is the full account history)...');
  const staging = await fetchAllStaging();
  console.log(`  ${staging.length} rows fetched.`);

  // Per contact: did ANY event ever match a genuine known source tag?
  const contactMatchedReal = new Map<string, boolean>();
  const contactHadExcluded = new Map<string, boolean>();
  for (const row of staging) {
    if (!row.ac_contact_id) continue;
    const tags = row.raw_payload.tags ?? [];
    const matched = matchSourceTag(tags, knownTags);
    if (matched) contactMatchedReal.set(row.ac_contact_id, true);
    if (isExcludedSourceOnly(tags, matched !== null)) {
      contactHadExcluded.set(row.ac_contact_id, true);
    }
  }

  const inScopeContactIds = new Set<string>();
  for (const [contactId, hadExcluded] of contactHadExcluded) {
    if (hadExcluded && !contactMatchedReal.get(contactId)) {
      inScopeContactIds.add(contactId);
    }
  }
  console.log(`\nContacts with an excluded-only signal across their whole history: ${inScopeContactIds.size}`);

  interface Registrant { id: string; ac_contact_id: string | null; email: string | null; first_name: string | null; last_name: string | null; }
  interface TwolRespondent { id: number; ac_contact_id: string | null; email: string | null; first_name: string | null; last_name: string | null; }

  const allRegistrants = await fetchAll<Registrant>('registry', 'registrants', 'id, ac_contact_id, email, first_name, last_name');
  const allTwol = await fetchAll<TwolRespondent>('registry', 'twol_respondents', 'id, ac_contact_id, email, first_name, last_name');

  const affectedRegistrants = allRegistrants.filter((r) => r.ac_contact_id && inScopeContactIds.has(r.ac_contact_id));
  const affectedTwol = allTwol.filter((r) => r.ac_contact_id && inScopeContactIds.has(r.ac_contact_id));

  console.log(`registry.registrants rows to delete: ${affectedRegistrants.length}`);
  console.log(`registry.twol_respondents rows to delete: ${affectedTwol.length}`);

  if (affectedRegistrants.length === 0 && affectedTwol.length === 0) {
    console.log('Nothing to clean up.');
    return;
  }

  // Also grab the affected registration_events, for the backup / and because
  // deleting the registrant cascades them anyway.
  const affectedRegistrantIds = affectedRegistrants.map((r) => r.id);
  let affectedEvents: unknown[] = [];
  for (let i = 0; i < affectedRegistrantIds.length; i += PAGE_SIZE) {
    const batch = affectedRegistrantIds.slice(i, i + PAGE_SIZE);
    if (batch.length === 0) continue;
    const { data, error } = await supabase.schema('registry').from('registration_events').select('*').in('registrant_id', batch);
    if (error) throw error;
    affectedEvents = affectedEvents.concat(data ?? []);
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(OUT_DIR, `excluded_tag_cleanup_${stamp}.json`);
  fs.writeFileSync(backupPath, JSON.stringify({ registrants: affectedRegistrants, registration_events: affectedEvents, twol_respondents: affectedTwol }, null, 2));
  console.log(`Backed up affected rows -> ${backupPath}`);

  console.log(`\n${apply ? 'APPLYING' : 'DRY RUN'}`);
  console.log('\nSample registrants that would be deleted:');
  for (const r of affectedRegistrants.slice(0, 10)) {
    console.log(`  ${r.first_name ?? ''} ${r.last_name ?? ''} <${r.email ?? 'no email'}>`);
  }
  console.log('\nSample twol_respondents that would be deleted:');
  for (const r of affectedTwol.slice(0, 10)) {
    console.log(`  ${r.first_name ?? ''} ${r.last_name ?? ''} <${r.email ?? 'no email'}>`);
  }

  if (!apply) {
    console.log('\nRe-run with --apply to actually delete.');
    return;
  }

  if (affectedRegistrantIds.length > 0) {
    console.log('\nDeleting from registry.registrants (registration_events cascade)...');
    for (let i = 0; i < affectedRegistrantIds.length; i += PAGE_SIZE) {
      const batch = affectedRegistrantIds.slice(i, i + PAGE_SIZE);
      const { error } = await supabase.schema('registry').from('registrants').delete().in('id', batch);
      if (error) throw error;
    }
    console.log(`  ${affectedRegistrantIds.length} registrants deleted.`);
  }

  const affectedTwolIds = affectedTwol.map((r) => r.id);
  if (affectedTwolIds.length > 0) {
    console.log('Deleting from registry.twol_respondents...');
    for (let i = 0; i < affectedTwolIds.length; i += PAGE_SIZE) {
      const batch = affectedTwolIds.slice(i, i + PAGE_SIZE);
      const { error } = await supabase.schema('registry').from('twol_respondents').delete().in('id', batch);
      if (error) throw error;
    }
    console.log(`  ${affectedTwolIds.length} twol_respondents deleted.`);
  }

  console.log('\nDone.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
