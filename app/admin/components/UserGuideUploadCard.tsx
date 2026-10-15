'use client';

import { useEffect, useRef, useState } from 'react';
import { getErrorMessage } from '@/lib/errorUtils';
import { fetchUserGuide, uploadUserGuide } from '@/lib/services/userGuideClient';
import { formatGuideDate, validateUserGuideFile, type UserGuideView } from '@/lib/services/userGuideService';

/**
 * Admin hub card: shows the CAS User Guide leaders currently see behind the
 * "OPEN GUIDE" button, and lets an admin replace it with a new PDF.
 */
export default function UserGuideUploadCard() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  // undefined = still loading; null = no guide uploaded yet
  const [current, setCurrent] = useState<UserGuideView | null | undefined>(undefined);
  const [selected, setSelected] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetchUserGuide()
      .then((guide) => { if (!cancelled) setCurrent(guide); })
      .catch((err: unknown) => {
        if (!cancelled) {
          setCurrent(null);
          setError(getErrorMessage(err, 'Could not load the current guide'));
        }
      });
    return () => { cancelled = true; };
  }, [reloadKey]);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    setError(null);
    setMessage(null);
    const file = e.target.files?.[0] ?? null;
    if (!file) { setSelected(null); return; }
    const header = new Uint8Array(await file.slice(0, 5).arrayBuffer());
    const problem = validateUserGuideFile(file, header);
    if (problem) {
      setError(problem);
      setSelected(null);
      e.target.value = '';
      return;
    }
    setSelected(file);
  };

  const handleUpload = async () => {
    if (!selected) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await uploadUserGuide(selected);
      setMessage(`"${selected.name}" is now the guide leaders see.`);
      setSelected(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      setReloadKey((k) => k + 1);
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Upload failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-lg border-2 border-gray-800 dark:border-gray-600 bg-white p-4 shadow-sm dark:bg-gray-800">
      <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">CAS User Guide</h2>
      <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
        The PDF leaders open with the &ldquo;OPEN GUIDE&rdquo; button. Uploading a new PDF replaces it straight away.
      </p>

      <p className="mt-3 text-sm text-gray-800 dark:text-gray-200">
        {current === undefined ? (
          'Checking the current guide…'
        ) : current ? (
          <>
            Current guide uploaded {formatGuideDate(current.uploadedAt)} —{' '}
            <a href={current.url} target="_blank" rel="noopener noreferrer" className="font-semibold text-blue-600 underline dark:text-blue-400">
              view it
            </a>
          </>
        ) : (
          'No guide has been uploaded yet.'
        )}
      </p>

      <label className="mt-4 block text-sm font-medium text-gray-700 dark:text-gray-300">
        New guide (PDF)
        <input
          ref={fileInputRef}
          type="file"
          accept="application/pdf,.pdf"
          onChange={handleFileChange}
          disabled={busy}
          className="mt-1 block w-full text-sm text-gray-700 file:mr-3 file:rounded-md file:border-2 file:border-gray-800 file:bg-gray-100 file:px-3 file:py-1.5 file:font-semibold dark:text-gray-300 dark:file:border-gray-600 dark:file:bg-gray-700 dark:file:text-gray-200"
        />
      </label>

      <button
        onClick={handleUpload}
        disabled={!selected || busy}
        className="mt-4 rounded-md bg-blue-600 px-4 py-2 text-base font-bold text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 border-2 border-gray-800 dark:border-gray-600"
      >
        {busy ? 'Uploading…' : 'Upload and replace guide'}
      </button>

      {message && <p className="mt-3 text-sm font-semibold text-green-700 dark:text-green-300">{message}</p>}
      {error && <p className="mt-3 text-sm font-semibold text-red-700 dark:text-red-300">{error}</p>}
    </div>
  );
}
