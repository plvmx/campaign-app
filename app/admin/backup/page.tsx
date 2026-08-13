'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import MobileLayout from '@/components/MobileLayout';
import LoadingSpinner from '@/components/LoadingSpinner';
import { useUser } from '@/contexts/UserContext';
import { supabase } from '@/lib/supabaseClient';
import { getErrorMessage } from '@/lib/errorUtils';
import { trackEvent } from '@/lib/analytics';
import {
  BACKUP_TABLE_CONFIG,
  exportBackup,
  restoreBackup,
  isValidBackupFile,
  type BackupData,
  type BackupTableKey,
  type RestoreMode,
} from '@/lib/services/backupService';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** All table keys checked/selected by default — a "full backup" out of the box. */
const ALL_KEYS: BackupTableKey[] = BACKUP_TABLE_CONFIG.map((cfg) => cfg.key);

function allChecked(keys: BackupTableKey[] = ALL_KEYS): Record<BackupTableKey, boolean> {
  return Object.fromEntries(ALL_KEYS.map((key) => [key, keys.includes(key)])) as Record<BackupTableKey, boolean>;
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function BackupPage() {
  const router = useRouter();
  const { user, isAdmin, isLoading: isUserLoading } = useUser();

  // Export checkboxes — every table selected by default (a "full backup").
  const [exportSelected, setExportSelected] = useState<Record<BackupTableKey, boolean>>(() => allChecked());
  const [isExporting, setIsExporting] = useState(false);

  // Import state
  const [backupFile,     setBackupFile]     = useState<BackupData | null>(null);
  const [backupFileName, setBackupFileName] = useState('');
  const [restoreMode,    setRestoreMode]    = useState<RestoreMode>('merge');
  const [restoreConfirm, setRestoreConfirm] = useState(false);
  const [isRestoring,    setIsRestoring]    = useState(false);

  // Per-table restore toggles — set from the uploaded backup file's contents.
  const [restoreSelected, setRestoreSelected] = useState<Record<BackupTableKey, boolean>>(() => allChecked([]));

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

  const selectedExportKeys = ALL_KEYS.filter((key) => exportSelected[key]);

  const handleExport = async () => {
    if (selectedExportKeys.length === 0) {
      setError('Please select at least one table to include in the backup.');
      return;
    }

    setIsExporting(true);
    setError(null);
    setSuccess(null);
    setStatusLog([]);

    try {
      const backup = await exportBackup(supabase, selectedExportKeys, addLog);

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
      trackEvent('backup_export', { tables: selectedExportKeys });
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
        const parsed = JSON.parse(ev.target?.result as string) as unknown;
        if (!isValidBackupFile(parsed)) {
          throw new Error('Not a valid backup file — missing exported_at or version.');
        }
        setBackupFile(parsed);
        // Default: restore only tables present in the file
        setRestoreSelected(allChecked(ALL_KEYS.filter((key) => !!parsed[key])));
      } catch (err) {
        setError(getErrorMessage(err, 'Failed to parse backup file'));
      }
    };
    reader.readAsText(file);
  };

  const selectedRestoreKeys = ALL_KEYS.filter((key) => restoreSelected[key] && !!backupFile?.[key]);

  const handleRestore = async () => {
    if (!backupFile) return;

    setIsRestoring(true);
    setError(null);
    setSuccess(null);
    setStatusLog([]);
    setRestoreConfirm(false);

    try {
      await restoreBackup(supabase, backupFile, selectedRestoreKeys, restoreMode, addLog);

      addLog('✅ Restore completed successfully.');
      setSuccess('Restore completed successfully.');
      trackEvent('backup_restore', { mode: restoreMode, tables: selectedRestoreKeys });
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
            can restore from it if needed. Every table is included by default for a full backup.
          </p>

          <fieldset className="mb-4 space-y-2">
            <legend className="mb-2 text-sm font-medium text-gray-700 dark:text-gray-300">
              Tables to include
            </legend>
            {BACKUP_TABLE_CONFIG.map(({ key, label }) => (
              <label key={key} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={exportSelected[key]}
                  onChange={(e) => setExportSelected((prev) => ({ ...prev, [key]: e.target.checked }))}
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
                  {BACKUP_TABLE_CONFIG.map(({ key, label }) => {
                    const rows = backupFile[key];
                    if (!rows) return null;
                    return <li key={key}>• {rows.length.toLocaleString()} {label.toLowerCase()}</li>;
                  })}
                </ul>
              </div>

              {/* Tables to restore */}
              <fieldset className="mb-5 space-y-2">
                <legend className="mb-2 text-sm font-medium text-gray-700 dark:text-gray-300">
                  Tables to restore
                </legend>
                {BACKUP_TABLE_CONFIG.map(({ key, label }) => {
                  const available = !!backupFile[key];
                  return (
                    <label
                      key={key}
                      className={`flex items-center gap-2 ${available ? 'cursor-pointer' : 'cursor-not-allowed opacity-40'}`}
                    >
                      <input
                        type="checkbox"
                        checked={restoreSelected[key] && available}
                        disabled={!available}
                        onChange={(e) => setRestoreSelected((prev) => ({ ...prev, [key]: e.target.checked }))}
                        className="h-4 w-4 rounded border-gray-300"
                      />
                      <span className="text-sm text-gray-700 dark:text-gray-300">
                        {label}
                        {!available && (
                          <span className="ml-1 text-xs text-gray-400">(not in this backup)</span>
                        )}
                      </span>
                    </label>
                  );
                })}
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
                        from backup exactly; use this to fully undo corruption. Replacing
                        Campaigns without also replacing Results (or vice versa) can fail, since
                        each result row references a campaign — select both together, or use
                        Merge instead.
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
                disabled={isRestoring || selectedRestoreKeys.length === 0 || (restoreMode === 'replace' && !restoreConfirm)}
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
