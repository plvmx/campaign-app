/**
 * Backup & Restore (app/admin/backup/page.tsx) — export/import a JSON snapshot
 * of every admin-curated table in the app. Deliberately excludes tables that
 * are either pure operational history (campaign_changes_log, results_changes_log,
 * weekly_refresh_log, app_events — high-volume, already rolling-pruned, and
 * reconstructable from nothing but their own accumulation) or tied to Supabase
 * Auth identities (user_profiles, user_roles — keyed by auth.users.id, which
 * this JSON format has no way to restore, and which self-heal from
 * state_leaders + normal login rather than being admin-authored content).
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export type BackupTableKey =
  | 'state_leaders'
  | 'state_places'
  | 'campaign_categories'
  | 'campaigns'
  | 'results'
  | 'campaign_interest'
  | 'campaign_rules'
  | 'campaign_messages'
  | 'leader_shares'
  | 'state_refresh_settings'
  | 'app_settings';

interface BackupTableConfig {
  key: BackupTableKey;
  table: string;
  label: string;
  /** Column that uniquely identifies a row — used to fetch/delete-by-key in "replace" restore mode. */
  keyField: string;
  orderBy: [column: string, ascending: boolean][];
}

/**
 * One entry per backed-up table, in FK-safe order: a table only ever appears
 * *after* every table it references. `restoreBackup` inserts top-to-bottom and
 * (in "replace" mode) deletes bottom-to-top, so e.g. `results` — which has a
 * foreign key to `campaigns.id` — is always inserted after campaigns exist and
 * cleared before campaigns are deleted.
 */
export const BACKUP_TABLE_CONFIG: BackupTableConfig[] = [
  { key: 'state_leaders',          table: 'state_leaders',          label: 'State Leaders',          keyField: 'id',          orderBy: [['state', true], ['leader', true]] },
  { key: 'state_places',           table: 'state_places',           label: 'State Places',           keyField: 'id',          orderBy: [['state', true], ['place', true]] },
  { key: 'campaign_categories',    table: 'campaign_categories',    label: 'Campaign Categories',    keyField: 'id',          orderBy: [['code', true]] },
  { key: 'campaigns',              table: 'campaigns',              label: 'Campaigns',              keyField: 'id',          orderBy: [['date', true]] },
  { key: 'results',                table: 'results',                label: 'Results',                keyField: 'id',          orderBy: [['created_at', true]] },
  { key: 'campaign_interest',      table: 'campaign_interest',      label: 'Campaign Interest',      keyField: 'id',          orderBy: [['created_at', true]] },
  { key: 'campaign_rules',         table: 'campaign_rules',         label: 'Campaign Rules',         keyField: 'id',          orderBy: [['state', true], ['name', true]] },
  { key: 'campaign_messages',      table: 'campaign_messages',      label: 'Campaign Messages',      keyField: 'date',        orderBy: [['date', true]] },
  { key: 'leader_shares',          table: 'leader_shares',          label: 'Leader Shares',          keyField: 'id',          orderBy: [['owner_state', true], ['owner_leader', true]] },
  { key: 'state_refresh_settings', table: 'state_refresh_settings', label: 'State Refresh Settings', keyField: 'state',       orderBy: [['state', true]] },
  { key: 'app_settings',           table: 'app_settings',           label: 'App Settings',           keyField: 'setting_key', orderBy: [['setting_key', true]] },
];

export type BackupTableData = Record<string, unknown>[];

export type BackupData = {
  exported_at: string;
  version: string;
} & Partial<Record<BackupTableKey, BackupTableData>>;

/** Current export format version. Bump when the set of backed-up tables changes. */
export const BACKUP_FORMAT_VERSION = '3';

export function isValidBackupFile(parsed: unknown): parsed is BackupData {
  return (
    !!parsed &&
    typeof parsed === 'object' &&
    typeof (parsed as BackupData).exported_at === 'string' &&
    typeof (parsed as BackupData).version === 'string'
  );
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export async function exportBackup(
  client: SupabaseClient,
  selectedKeys: BackupTableKey[],
  onProgress?: (message: string) => void,
): Promise<BackupData> {
  const backup: BackupData = { exported_at: new Date().toISOString(), version: BACKUP_FORMAT_VERSION };

  for (const cfg of BACKUP_TABLE_CONFIG) {
    if (!selectedKeys.includes(cfg.key)) continue;

    onProgress?.(`Exporting ${cfg.label}…`);
    let query = client.from(cfg.table).select('*');
    for (const [column, ascending] of cfg.orderBy) {
      query = query.order(column, { ascending });
    }
    const { data, error } = await query;
    if (error) throw error;

    const rows = (data ?? []) as BackupTableData;
    backup[cfg.key] = rows;
    onProgress?.(`  ✓ ${rows.length} ${cfg.label.toLowerCase()}`);
  }

  return backup;
}

// ---------------------------------------------------------------------------
// Restore
// ---------------------------------------------------------------------------

const BATCH_SIZE = 500;

async function insertRecords(client: SupabaseClient, table: string, records: BackupTableData): Promise<void> {
  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const { error } = await client.from(table).insert(records.slice(i, i + BATCH_SIZE));
    if (error) throw error;
  }
}

async function upsertRecords(client: SupabaseClient, table: string, records: BackupTableData): Promise<void> {
  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const { error } = await client.from(table).upsert(records.slice(i, i + BATCH_SIZE));
    if (error) throw error;
  }
}

/** Deletes every current row in `table`, in batches, keyed on `keyField`. */
async function deleteAllRecords(client: SupabaseClient, table: string, keyField: string): Promise<void> {
  const { data: current, error: fetchError } = await client.from(table).select(keyField);
  if (fetchError) throw fetchError;

  const currentKeys = ((current ?? []) as unknown as Record<string, unknown>[]).map((row) => row[keyField]);
  for (let i = 0; i < currentKeys.length; i += BATCH_SIZE) {
    const { error } = await client.from(table).delete().in(keyField, currentKeys.slice(i, i + BATCH_SIZE));
    if (error) throw error;
  }
}

export type RestoreMode = 'merge' | 'replace';

/**
 * Restores the selected tables from `backup`.
 *
 * "merge" upserts records (adds/updates; nothing is deleted).
 * "replace" deletes every current row in each selected table and reinserts
 * exactly what's in the backup. To stay FK-safe regardless of which tables
 * are selected, "replace" runs as two passes over the *selected* tables —
 * a delete pass in reverse config order (children before parents), then an
 * insert pass in forward config order (parents before children) — rather
 * than delete-then-insert one table at a time.
 */
export async function restoreBackup(
  client: SupabaseClient,
  backup: BackupData,
  selectedKeys: BackupTableKey[],
  mode: RestoreMode,
  onProgress?: (message: string) => void,
): Promise<void> {
  const selected = BACKUP_TABLE_CONFIG.filter(
    (cfg) => selectedKeys.includes(cfg.key) && backup[cfg.key] !== undefined,
  );

  if (mode === 'replace') {
    for (const cfg of [...selected].reverse()) {
      onProgress?.(`Clearing existing ${cfg.label.toLowerCase()}…`);
      await deleteAllRecords(client, cfg.table, cfg.keyField);
    }
  }

  for (const cfg of selected) {
    const records = backup[cfg.key] as BackupTableData;
    onProgress?.(`Restoring ${cfg.label} (${mode})…`);
    if (mode === 'replace') {
      await insertRecords(client, cfg.table, records);
    } else {
      await upsertRecords(client, cfg.table, records);
    }
    onProgress?.(`  ✓ ${records.length} ${cfg.label.toLowerCase()} restored`);
  }
}
