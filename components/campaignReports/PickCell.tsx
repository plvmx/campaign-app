'use client';

import { useState } from 'react';
import { getErrorMessage } from '@/lib/errorUtils';

const ADD_NEW = '__add_new__';

const controlClass =
  'rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 disabled:bg-gray-100 dark:disabled:bg-gray-800';

/**
 * A pick-from-a-list cell for the Campaign Reports Edit mode. A native
 * <select> on purpose: the earlier text box + <datalist> showed no choices at
 * all on phones (mobile browsers barely support datalist), whereas a select
 * opens the platform's own picker everywhere. With `allowNew`, a final
 * "+ Add a new …" choice swaps in a text box for a value that isn't listed.
 * Saves as soon as a choice is made; a failure shows the message and the
 * select snaps back to the stored value. Callers key it on the stored value.
 */
export default function PickCell({
  value, options, disabled, blankLabel = '—', disabledLabel, newLabel, onSave,
}: {
  value: string | null;
  options: string[];
  disabled?: boolean;
  blankLabel?: string;
  disabledLabel?: string;
  /** Adds a "+ <newLabel>" choice that lets the user type a value not in `options`. */
  newLabel?: string;
  onSave: (value: string | null) => Promise<void>;
}) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const commit = async (next: string | null) => {
    setSaving(true);
    setError('');
    try {
      await onSave(next);
      setAdding(false);
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Failed to save'));
    } finally {
      setSaving(false);
    }
  };

  // The stored value is always selectable, even if it has since left the list.
  const listed = value && !options.includes(value) ? [value, ...options] : options;

  return (
    <div>
      {adding ? (
        <div className="flex flex-col gap-1">
          <input
            value={draft}
            autoFocus
            disabled={saving}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && draft.trim()) commit(draft.trim()); }}
            placeholder={newLabel}
            aria-label={newLabel}
            className={`${controlClass} w-44`}
          />
          <div className="flex gap-2">
            <button
              type="button"
              disabled={saving || !draft.trim()}
              onClick={() => commit(draft.trim())}
              className="rounded-md bg-blue-600 px-3 py-1 text-xs font-bold text-white disabled:bg-gray-400"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => { setAdding(false); setDraft(''); setError(''); }}
              className="rounded-md border border-gray-400 px-3 py-1 text-xs font-semibold text-gray-700 dark:text-gray-200"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <select
          value={value ?? ''}
          disabled={disabled || saving}
          onChange={(e) => {
            if (e.target.value === ADD_NEW) { setAdding(true); return; }
            commit(e.target.value || null);
          }}
          className={`${controlClass} w-44`}
        >
          <option value="">{disabled && disabledLabel ? disabledLabel : blankLabel}</option>
          {listed.map((o) => <option key={o} value={o}>{o}</option>)}
          {newLabel && !disabled && <option value={ADD_NEW}>+ {newLabel}</option>}
        </select>
      )}
      {error && <p className="mt-1 max-w-[11rem] text-xs text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}
