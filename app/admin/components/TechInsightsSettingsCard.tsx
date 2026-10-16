'use client';

import { useEffect, useState } from 'react';
import { getErrorMessage } from '@/lib/errorUtils';
import { getTechInsightsConfig, setTechInsightsEnabled, setTechInsightsHotkey, type TechInsightsConfig } from '@/lib/appSettings';
import { DEFAULT_TECH_INSIGHTS_HOTKEY, hotkeyFromEvent, normalizeHotkey } from '@/lib/techInsights/hotkey';

/**
 * Admin hub card: switches Tech Insights (the on-screen technical details
 * panel — see lib/techInsights/) on or off for every full admin, and sets the
 * keyboard shortcut that opens it. The panel itself only ever appears on a
 * desktop-class device for a full admin signed in with 2FA.
 */
export default function TechInsightsSettingsCard() {
  const [config, setConfig] = useState<TechInsightsConfig | null>(null);
  const [draftHotkey, setDraftHotkey] = useState(DEFAULT_TECH_INSIGHTS_HOTKEY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getTechInsightsConfig().then((c) => {
      if (cancelled) return;
      setConfig(c);
      setDraftHotkey(c.hotkey);
    });
    return () => { cancelled = true; };
  }, []);

  const run = async (action: () => Promise<void>, success: string) => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await action();
      setMessage(success);
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Could not save the setting'));
    } finally {
      setBusy(false);
    }
  };

  const toggle = () => {
    if (!config) return;
    const enabled = !config.enabled;
    void run(async () => {
      await setTechInsightsEnabled(enabled);
      setConfig({ ...config, enabled });
    }, enabled ? 'Tech Insights is on.' : 'Tech Insights is off.');
  };

  const saveHotkey = () => {
    if (!config) return;
    void run(async () => {
      await setTechInsightsHotkey(draftHotkey);
      const saved = normalizedDraft ?? draftHotkey;
      setConfig({ ...config, hotkey: saved });
      setDraftHotkey(saved);
    }, 'Shortcut saved. Open pages pick it up the next time they load.');
  };

  const normalizedDraft = normalizeHotkey(draftHotkey);
  const hotkeyChanged = config !== null && normalizedDraft !== null && normalizedDraft !== config.hotkey;

  return (
    <div className="rounded-lg border-2 border-gray-800 dark:border-gray-600 bg-white p-4 shadow-sm dark:bg-gray-800">
      <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Tech Insights</h2>
      <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
        Press the shortcut on any screen to see its technical details: the files behind it, what they import, which
        database tables and API routes they use, and the code itself. Desktop browsers only, and only for full admins
        signed in with 2FA.
      </p>

      <div className="mt-4 flex items-center justify-between gap-3">
        <span className="text-sm font-medium text-gray-800 dark:text-gray-200">
          {config === null ? 'Loading…' : config.enabled ? 'On' : 'Off'}
        </span>
        <button
          onClick={toggle}
          disabled={config === null || busy}
          className="rounded-md bg-blue-600 px-4 py-2 text-base font-bold text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 border-2 border-gray-800 dark:border-gray-600"
        >
          {config?.enabled ? 'Turn off' : 'Turn on'}
        </button>
      </div>

      <label className="mt-4 block text-sm font-medium text-gray-700 dark:text-gray-300">
        Keyboard shortcut — click the box, then press the keys
        <input
          readOnly
          value={draftHotkey}
          onKeyDown={(e) => {
            // Ignore bare modifier presses and invalid combinations; let Tab move on.
            if (e.key === 'Tab') return;
            e.preventDefault();
            const combo = hotkeyFromEvent(e);
            if (combo) { setDraftHotkey(combo); setMessage(null); setError(null); }
            else if (!['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) setError('Use Ctrl, Alt or Meta together with a letter, digit or F-key.');
          }}
          className="mt-1 block w-full rounded-md border-2 border-gray-800 bg-white px-3 py-2 font-mono text-base text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
        />
      </label>
      <button
        onClick={saveHotkey}
        disabled={!hotkeyChanged || busy}
        className="mt-3 rounded-md bg-blue-600 px-4 py-2 text-base font-bold text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 border-2 border-gray-800 dark:border-gray-600"
      >
        Save shortcut
      </button>

      {message && <p className="mt-3 text-sm font-semibold text-green-700 dark:text-green-300">{message}</p>}
      {error && <p className="mt-3 text-sm font-semibold text-red-700 dark:text-red-300">{error}</p>}
    </div>
  );
}
