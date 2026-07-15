/**
 * One-off migration: splits the baked-in numeric suffix out of `place` (e.g.
 * "Orange 1") into the new `site` column, for state_places, campaigns, and
 * campaign_rules.
 *
 * Requires docs/migrations/005_add_site_column.sql to have already been applied
 * (the `site` column must exist on all three tables).
 *
 * Usage:
 *   node scripts/migrate_place_site_split.js            # dry run, prints planned changes
 *   node scripts/migrate_place_site_split.js --apply    # actually writes the updates
 */
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const envPath = path.join(__dirname, '..', '.env.local');
fs.readFileSync(envPath, 'utf-8').split('\n').forEach((line) => {
  const t = line.trim();
  if (!t || t.startsWith('#')) return;
  const [k, ...rest] = t.split('=');
  if (k && rest.length) process.env[k.trim()] = rest.join('=').trim().replace(/^["']|["']$/g, '');
});

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const APPLY = process.argv.includes('--apply');

/** Mirrors lib/placeSite.ts splitPlaceAndSite — kept inline since this is a plain CJS script. */
function splitPlaceAndSite(raw) {
  const collapsed = raw.trim().replace(/\s+/g, ' ');
  const match = collapsed.match(/^(.*\S)\s+(\d+)$/);
  if (match) return { place: match[1], site: match[2] };
  return { place: collapsed, site: '' };
}

async function migrateTable(table, idColumn = 'id') {
  const { data, error } = await supabase.from(table).select(`${idColumn}, place, site`);
  if (error) {
    console.error(`Failed to read ${table}:`, error);
    return { table, planned: 0, applied: 0 };
  }

  const changes = [];
  for (const row of data || []) {
    if (typeof row.place !== 'string') continue;
    const { place, site } = splitPlaceAndSite(row.place);
    // Only touch rows that actually have a baked-in numeric suffix to split out.
    // Rows already split (site already set, or place has no trailing digits) are left alone.
    if (site && (place !== row.place || site !== (row.site || ''))) {
      changes.push({ id: row[idColumn], before: { place: row.place, site: row.site || '' }, after: { place, site } });
    }
  }

  console.log(`\n=== ${table}: ${changes.length} row(s) to update ===`);
  for (const c of changes) {
    console.log(`  ${c.id}: "${c.before.place}" (site="${c.before.site}") -> place="${c.after.place}" site="${c.after.site}"`);
  }

  let applied = 0;
  if (APPLY) {
    for (const c of changes) {
      const { error: updateError } = await supabase
        .from(table)
        .update({ place: c.after.place, site: c.after.site })
        .eq(idColumn, c.id);
      if (updateError) {
        console.error(`  Failed to update ${table} row ${c.id}:`, updateError);
      } else {
        applied++;
      }
    }
  }

  return { table, planned: changes.length, applied };
}

(async () => {
  console.log(APPLY ? 'Running in APPLY mode — rows will be updated.' : 'Running in DRY RUN mode — no rows will be changed. Pass --apply to write.');

  const results = [];
  results.push(await migrateTable('state_places'));
  results.push(await migrateTable('campaigns'));
  results.push(await migrateTable('campaign_rules'));

  console.log('\n=== Summary ===');
  for (const r of results) {
    console.log(`${r.table}: ${APPLY ? `${r.applied} updated` : `${r.planned} would update`}`);
  }
})();
