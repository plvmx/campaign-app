'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import MobileLayout from '@/components/MobileLayout';
import LoadingSpinner from '@/components/LoadingSpinner';
import { useUser } from '@/contexts/UserContext';
import { supabase } from '@/lib/supabaseClient';
import { getErrorMessage } from '@/lib/errorUtils';
import type { Campaign } from '@/lib/types';
import type { CampaignRule } from '@/lib/types';

// ─── Local types ──────────────────────────────────────────────────────────────

interface StateLeader {
  id: string;
  state: string;
  leader: string;
  mobile: string | null;
  admin: string | null;
  created_at?: string;
}

interface StatePlace {
  id: string;
  state: string;
  place: string;
  created_at?: string;
}

interface BackupData {
  exported_at: string;
  version: string;
  campaigns?: Campaign[];
  state_leaders?: StateLeader[];
  state_places?: StatePlace[];
  campaign_rules?: CampaignRule[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const BATCH_SIZE = 500;

async function upsertRecords<T extends { id: string }>(
  table: string,
  records: T[],
): Promise<void> {
  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const { error } = await supabase.from(table).upsert(records.slice(i, i + BATCH_SIZE));
    if (error) throw error;
  }
}

async function replaceRecords<T extends { id: string }>(
  table: string,
  records: T[],
): Promise<void> {
  // Fetch all current IDs then delete in batches to satisfy RLS
  const { data: current, error: fetchErr } = await supabase.from(table).select('id');
  if (fetchErr) throw fetchErr;

  const currentIds = (current ?? []).map((r: { id: string }) => r.id);
  for (let i = 0; i < currentIds.length; i += BATCH_SIZE) {
    const { error } = await supabase
      .from(table)
      .delete()
      .in('id', currentIds.slice(i, i + BATCH_SIZE));
    if (error) throw error;
  }

  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const { error } = await supabase.from(table).insert(records.slice(i, i + BATCH_SIZE));
    if (error) throw error;
  }
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function BackupPage() {
  const router = useRouter();
  const { user, isAdmin, isLoading: isUserLoading } = useUser();

  // Export checkboxes
  const [exportCampaigns,     setExportCampaigns]     = useState(true);
  const [exportStateLeaders,  setExportStateLeaders]  = useState(true);
  const [exportStatePlaces,   setExportStatePlaces]   = useState(true);
  const [exportCampaignRules, setExportCampaignRules] = useState(true);
  const [isExporting,         setIsExporting]         = useState(false);

  // Import state
  const [backupFile,     setBackupFile]     = useState<BackupData | null>(null);
  const [backupFileName, setBackupFileName] = useState('');
  const [restoreMode,    setRestoreMode]    = useState<'merge' | 'replace'>('merge');
  const [restoreConfirm, setRestoreConfirm] = useState(false);
  const [isRestoring,    setIsRestoring]    = useState(false);

  // Per-table restore toggles (set from backup file contents)
  const [restoreCampaigns,     setRestoreCampaigns]     = useState(false);
  const [restoreStateLeaders,  setRestoreStateLeaders]  = useState(false);
  const [restoreStatePlaces,   setRestoreStatePlaces]   = useState(false);
  const [restoreCampaignRules, setRestoreCampaignRules] = useState(false);

  const [error,     setError]     = useState<string | null>(null);
  const [success,   setSuccess]   = useState<string | null>(null);
  const [statusLog, setStatusLog] = useState<string[]>([]);

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isUserLoading) return;
    if (!user)    { router.push('/login'); return; }
    if (!isAdmin) { router.push('/admin'); return; }
  }, [isUserLoading, user, isAdmin, router]);

  const addLog = (msg: string) => setStatusLog(prev => [...prev, msg]);

  // ── Export ─────────────────────────────────────────────────────────────────

  const handleExport = async () => {
    if (!exportCampaigns && !exportStateLeaders && !exportStatePlaces && !exportCampaignRules) {
      setError('Please select at least one table to include in the backup.');
      return;
    }

    setIsExporting(true);
    setError(null);
    setSuccess(null);
    setStatusLog([]);

    try {
      const backup: BackupData = { exported_at: new Date().toISOString(), version: '1' };

      if (exportCampaigns) {
        addLog('Exporting campaigns…');
        const { data, error } = await supabase
          .from('campaigns').select('*').order('date', { ascending: true });
        if (error) throw error;
        backup.campaigns = (data ?? []) as Campaign[];
        addLog(`  ✓ ${backup.campaigns.length} campaigns`);
      }

      if (exportStateLeaders) {
        addLog('Exporting state leaders…');
        const { data, error } = await supabase
          .from('state_leaders').select('*').order('state').order('leader');
        if (error) throw error;
        backup.state_leaders = (data ?? []) as StateLeader[];
        addLog(`  ✓ ${backup.state_leaders.length} state leaders`);
      }

      if (exportStatePlaces) {
        addLog('Exporting state places…');
        const { data, error } = await supabase
          .from('state_places').select('*').order('state').order('place');
        if (error) throw error;
        backup.state_places = (data ?? []) as StatePlace[];
        addLog(`  ✓ ${backup.state_places.length} state places`);
      }

      if (exportCampaignRules) {
        addLog('Exporting campaign rules…');
        const { data, error } = await supabase
          .from('campaign_rules').select('*').order('state').order('name');
        if (error) throw error;
        backup.campaign_rules = (data ?? []) as CampaignRule[];
        addLog(`  ✓ ${backup.campaign_rules.length} campaign rules`);
      }

      // Trigger browser download
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = `campaign-backup-${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      addLog('✅ Backup downloaded successfully.');
      setSuccess('Backup downloaded.');
    } catch (err) {
      setError(getErrorMessage(err, 'Export failed'));
    } finally {
      setIsExporting(false);
    }
  };

  // ── Import ─────────────────────────────────────────────────────────────────

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    setError(null);
    setSuccess(null);
    setStatusLog([]);
    setBackupFile(null);
    setRestoreConfirm(false);

    const file = e.target.files?.[0];
    if (!file) return;
    setBackupFileName(file.name);

    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const parsed = JSON.parse(ev.target?.result as string) as BackupData;
        if (!parsed.exported_at || !parsed.version) {
          throw new Error('Not a valid backup file — missing exported_at or version.');
        }
        setBackupFile(parsed);
        // Default: restore only tables present in the file
        setRestoreCampaigns(!!parsed.campaigns);
        setRestoreStateLeaders(!!parsed.state_leaders);
        setRestoreStatePlaces(!!parsed.state_places);
        setRestoreCampaignRules(!!parsed.campaign_rules);
      } catch (err) {
        setError(getErrorMessage(err, 'Failed to parse backup file'));
      }
    };
    reader.readAsText(file);
  };

  const handleRestore = async () => {
    if (!backupFile) return;

    setIsRestoring(true);
    setError(null);
    setSuccess(null);
    setStatusLog([]);
    setRestoreConfirm(false);

    const isReplace = restoreMode === 'replace';

    try {
      if (restoreCampaigns && backupFile.campaigns) {
        addLog(`Restoring campaigns (${restoreMode})…`);
        if (isReplace) {
          await replaceRecords('campaigns', backupFile.campaigns);
        } else {
          await upsertRecords('campaigns', backupFile.campaigns);
        }
        addLog(`  ✓ ${backupFile.campaigns.length} campaigns restored`);
      }

      if (restoreStateLeaders && backupFile.state_leaders) {
        addLog(`Restoring state leaders (${restoreMode})…`);
        if (isReplace) {
          await replaceRecords('state_leaders', backupFile.state_leaders);
        } else {
          await upsertRecords('state_leaders', backupFile.state_leaders);
        }
        addLog(`  ✓ ${backupFile.state_leaders.length} state leaders restored`);
      }

      if (restoreStatePlaces && backupFile.state_places) {
        addLog(`Restoring state places (${restoreMode})…`);
        if (isReplace) {
          await replaceRecords('state_places', backupFile.state_places);
        } else {
          await upsertRecords('state_places', backupFile.state_places);
        }
        addLog(`  ✓ ${backupFile.state_places.length} state places restored`);
      }

      if (restoreCampaignRules && backupFile.campaign_rules) {
        addLog(`Restoring campaign rules (${restoreMode})…`);
        if (isReplace) {
          await replaceRecords('campaign_rules', backupFile.campaign_rules);
        } else {
          await upsertRecords('campaign_rules', backupFile.campaign_rules);
        }
        addLog(`  ✓ ${backupFile.campaign_rules.length} campaign rules restored`);
      }

      addLog('✅ Restore completed successfully.');
      setSuccess('Restore completed successfully.');
    } catch (err) {
      setError(getErrorMessage(err, 'Restore failed'));
    } finally {
      setIsRestoring(false);
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  if (isUserLoading) {
    return (
      <MobileLayout>
        <div className="flex min-h-screen items-center justify-center">
          <LoadingSpinner />
        </div>
      </MobileLayout>
    );
  }

  const exportTableRows = [
    { label: 'Campaigns',      value: exportCampaigns,     setter: setExportCampaigns     },
    { label: 'State Leaders',  value: exportStateLeaders,  setter: setExportStateLeaders  },
    { label: 'State Places',   value: exportStatePlaces,   setter: setExportStatePlaces   },
    { label: 'Campaign Rules', value: exportCampaignRules, setter: setExportCampaignRules },
  ];

  const restoreTableRows = [
    { label: 'Campaigns',      available: !!backupFile?.campaigns,      value: restoreCampaigns,     setter: setRestoreCampaigns     },
    { label: 'State Leaders',  available: !!backupFile?.state_leaders,  value: restoreStateLeaders,  setter: setRestoreStateLeaders  },
    { label: 'State Places',   available: !!backupFile?.state_places,   value: restoreStatePlaces,   setter: setRestoreStatePlaces   },
    { label: 'Campaign Rules', available: !!backupFile?.campaign_rules, value: restoreCampaignRules, setter: setRestoreCampaignRules },
  ];

  return (
    <MobileLayout>
      <div className="mx-auto max-w-2xl p-4">

        <div className="mb-6">
          <Link
            href="/admin"
            className="text-sm text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
          >
            ← Back to Admin Panel
          </Link>
        </div>

        <h1 className="mb-6 text-2xl font-bold text-gray-900 dark:text-gray-100">
          Backup &amp; Restore
        </h1>

        {error && (
          <div className="mb-4 rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-800 dark:bg-red-900/20 dark:border-red-800 dark:text-red-200">
            {error}
          </div>
        )}
        {success && (
          <div className="mb-4 rounded-md bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-800 dark:bg-green-900/20 dark:border-green-800 dark:text-green-200">
            {success}
          </div>
        )}

        {/* ── Export ── */}
        <div className="mb-6 rounded-lg border-2 border-gray-800 dark:border-gray-600 bg-white p-5 shadow-sm dark:bg-gray-800">
          <h2 className="mb-1 text-lg font-semibold text-gray-900 dark:text-gray-100">
            Export Backup
          </h2>
          <p className="mb-4 text-sm text-gray-600 dark:text-gray-400">
            Download a JSON snapshot of the selected tables. Keep the file somewhere safe so you
            can restore from it if needed.
          </p>

          <fieldset className="mb-4 space-y-2">
            <legend className="mb-2 text-sm font-medium text-gray-700 dark:text-gray-300">
              Tables to include
            </legend>
            {exportTableRows.map(({ label, value, setter }) => (
              <label key={label} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={value}
                  onChange={(e) => setter(e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300"
                />
                <span className="text-sm text-gray-700 dark:text-gray-300">{label}</span>
              </label>
            ))}
          </fieldset>

          <button
            onClick={handleExport}
            disabled={isExporting}
            className="rounded-md bg-blue-600 px-4 py-2 text-base font-bold text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 border-2 border-gray-800 dark:border-gray-600"
          >
            {isExporting ? 'Exporting…' : '⬇ Download Backup'}
          </button>
        </div>

        {/* ── Import ── */}
        <div className="rounded-lg border-2 border-gray-800 dark:border-gray-600 bg-white p-5 shadow-sm dark:bg-gray-800">
          <h2 className="mb-1 text-lg font-semibold text-gray-900 dark:text-gray-100">
            Restore from Backup
          </h2>
          <p className="mb-4 text-sm text-gray-600 dark:text-gray-400">
            Upload a previously downloaded backup file to restore records.
          </p>

          <div className="mb-4">
            <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
              Select backup file (.json)
            </label>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json,application/json"
              onChange={handleFileSelect}
              className="block w-full text-sm text-gray-700 dark:text-gray-300
                file:mr-3 file:rounded-md file:border-2 file:border-gray-800
                file:bg-gray-100 file:px-3 file:py-1.5 file:text-sm file:font-bold
                file:text-gray-700 hover:file:bg-gray-200
                dark:file:border-gray-600 dark:file:bg-gray-700 dark:file:text-gray-300"
            />
          </div>

          {backupFile && (
            <>
              {/* Backup summary card */}
              <div className="mb-5 rounded-md bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 p-3 text-sm">
                <p className="font-semibold text-blue-800 dark:text-blue-300 mb-1">
                  📦 {backupFileName}
                </p>
                <p className="text-xs text-blue-600 dark:text-blue-400 mb-2">
                  Exported: {new Date(backupFile.exported_at).toLocaleString('en-AU')}
                </p>
                <ul className="space-y-0.5 text-blue-700 dark:text-blue-400">
                  {backupFile.campaigns      && <li>• {backupFile.campaigns.length.toLocaleString()} campaigns</li>}
                  {backupFile.state_leaders  && <li>• {backupFile.state_leaders.length.toLocaleString()} state leaders</li>}
                  {backupFile.state_places   && <li>• {backupFile.state_places.length.toLocaleString()} state places</li>}
                  {backupFile.campaign_rules && <li>• {backupFile.campaign_rules.length.toLocaleString()} campaign rules</li>}
                </ul>
              </div>

              {/* Tables to restore */}
              <fieldset className="mb-5 space-y-2">
                <legend className="mb-2 text-sm font-medium text-gray-700 dark:text-gray-300">
                  Tables to restore
                </legend>
                {restoreTableRows.map(({ label, available, value, setter }) => (
                  <label
                    key={label}
                    className={`flex items-center gap-2 ${available ? 'cursor-pointer' : 'cursor-not-allowed opacity-40'}`}
                  >
                    <input
                      type="checkbox"
                      checked={value && available}
                      disabled={!available}
                      onChange={(e) => setter(e.target.checked)}
                      className="h-4 w-4 rounded border-gray-300"
                    />
                    <span className="text-sm text-gray-700 dark:text-gray-300">
                      {label}
                      {!available && (
                        <span className="ml-1 text-xs text-gray-400">(not in this backup)</span>
                      )}
                    </span>
                  </label>
                ))}
              </fieldset>

              {/* Restore mode */}
              <fieldset className="mb-5">
                <legend className="mb-2 text-sm font-medium text-gray-700 dark:text-gray-300">
                  Restore mode
                </legend>
                <div className="space-y-3">
                  <label className="flex items-start gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="restoreMode"
                      value="merge"
                      checked={restoreMode === 'merge'}
                      onChange={() => setRestoreMode('merge')}
                      className="mt-0.5 h-4 w-4 border-gray-300"
                    />
                    <span className="text-sm text-gray-700 dark:text-gray-300">
                      <span className="font-semibold">Merge</span>
                      <span className="text-gray-500 dark:text-gray-400">
                        {' '}— adds and updates records from the backup; records that exist now
                        but are not in the backup are left untouched
                      </span>
                    </span>
                  </label>
                  <label className="flex items-start gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="restoreMode"
                      value="replace"
                      checked={restoreMode === 'replace'}
                      onChange={() => { setRestoreMode('replace'); setRestoreConfirm(false); }}
                      className="mt-0.5 h-4 w-4 border-gray-300"
                    />
                    <span className="text-sm text-gray-700 dark:text-gray-300">
                      <span className="font-semibold">Replace</span>
                      <span className="text-gray-500 dark:text-gray-400">
                        {' '}— deletes all current records in the selected tables, then restores
                        from backup exactly; use this to fully undo corruption
                      </span>
                    </span>
                  </label>
                </div>
              </fieldset>

              {/* Replace confirmation */}
              {restoreMode === 'replace' && (
                <div className="mb-5 rounded-md bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 p-3">
                  <label className="flex items-start gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={restoreConfirm}
                      onChange={(e) => setRestoreConfirm(e.target.checked)}
                      className="mt-0.5 h-4 w-4 rounded border-gray-300"
                    />
                    <span className="text-sm font-medium text-red-800 dark:text-red-300">
                      I understand this will permanently delete all current records in the selected
                      tables and replace them with the backup data. This cannot be undone.
                    </span>
                  </label>
                </div>
              )}

              <button
                onClick={handleRestore}
                disabled={isRestoring || (restoreMode === 'replace' && !restoreConfirm)}
                className="rounded-md bg-green-600 px-4 py-2 text-base font-bold text-white hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 border-2 border-gray-800 dark:border-gray-600"
              >
                {isRestoring ? 'Restoring…' : '⬆ Restore Backup'}
              </button>
            </>
          )}
        </div>

        {/* Status log */}
        {statusLog.length > 0 && (
          <div className="mt-4 rounded-md bg-gray-900 p-4 font-mono text-sm text-green-400">
            {statusLog.map((line, i) => (
              <div key={i}>{line}</div>
            ))}
          </div>
        )}

      </div>
    </MobileLayout>
  );
}
