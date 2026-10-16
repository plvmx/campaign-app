'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { fetchTechInsightsManifest, fetchTechInsightsSource } from '@/lib/techInsights/client';
import { computeReach, groupByKind, pathTo, summariseReach, KIND_SINGULAR } from '@/lib/techInsights/graph';
import { matchRoute } from '@/lib/techInsights/routeMatch';
import type { ExportInfo, FileEntry, TechInsightsManifest } from '@/lib/techInsights/types';
import { getErrorMessage } from '@/lib/errorUtils';

// Kept across open/close so reopening the panel is instant (the server data only changes on a new deploy).
let cachedManifest: TechInsightsManifest | null = null;

interface Props { onClose: () => void; hotkey: string }

const section = 'mt-4';
const heading = 'text-xs font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400';
const chip = 'rounded bg-gray-100 px-1.5 py-0.5 font-mono text-xs text-gray-800 dark:bg-gray-700 dark:text-gray-200';
const linkBtn = 'text-left font-mono text-xs text-blue-700 underline hover:text-blue-900 dark:text-blue-300';

export default function TechInsightsPanel({ onClose, hotkey }: Props) {
  const pathname = usePathname();
  const [manifest, setManifest] = useState<TechInsightsManifest | null>(cachedManifest);
  const [error, setError] = useState<string | null>(null);
  // null = the page itself
  const [selected, setSelected] = useState<string | null>(null);
  const [sources, setSources] = useState<Record<string, string>>({});
  const [showCode, setShowCode] = useState(false);
  const [range, setRange] = useState<{ start: number; end: number } | null>(null);
  const [codeError, setCodeError] = useState<string | null>(null);

  useEffect(() => {
    if (cachedManifest) return;
    let cancelled = false;
    fetchTechInsightsManifest()
      .then((m) => { cachedManifest = m; if (!cancelled) setManifest(m); })
      .catch((err: unknown) => { if (!cancelled) setError(getErrorMessage(err, 'Could not load Tech Insights data')); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const route = useMemo(() => (manifest ? matchRoute(pathname, manifest.routes) : null), [manifest, pathname]);
  const reach = useMemo(() => (manifest && route ? computeReach([route.file, ...route.layouts], manifest) : null), [manifest, route]);
  const summary = useMemo(() => (manifest && reach ? summariseReach(reach, manifest) : null), [manifest, reach]);
  const groups = useMemo(() => (manifest && reach ? groupByKind(reach.order, manifest.files) : []), [manifest, reach]);

  const currentPath = selected ?? route?.file ?? null;
  const file: FileEntry | null = manifest && currentPath ? manifest.files[currentPath] ?? null : null;
  const source = currentPath ? sources[currentPath] : undefined;

  const select = (path: string | null) => {
    setSelected(path);
    setShowCode(false);
    setRange(null);
    setCodeError(null);
  };

  const openCode = (path: string, r: { start: number; end: number } | null) => {
    setSelected(path);
    setRange(r);
    setShowCode(true);
    setCodeError(null);
    if (sources[path] === undefined) {
      fetchTechInsightsSource(path)
        .then((text) => setSources((prev) => ({ ...prev, [path]: text })))
        .catch((err: unknown) => setCodeError(getErrorMessage(err, 'Could not load the source')));
    }
  };

  const fileLink = (path: string) => (
    manifest?.files[path]
      ? <button key={path} onClick={() => select(path)} className={linkBtn}>{path}</button>
      : <span key={path} className={chip}>{path}</span>
  );

  const chain = reach && currentPath ? pathTo(reach, currentPath) : [];

  return (
    <aside
      role="dialog"
      aria-label="Tech Insights"
      className="fixed inset-y-0 right-0 z-[3000] flex w-[min(760px,100vw)] flex-col border-l-2 border-gray-800 bg-white text-gray-900 shadow-2xl dark:border-gray-500 dark:bg-gray-900 dark:text-gray-100"
    >
      <header className="flex items-center justify-between gap-3 border-b border-gray-300 px-4 py-3 dark:border-gray-700">
        <div>
          <h2 className="text-base font-bold">Tech Insights</h2>
          {manifest && (
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Built {new Date(manifest.generatedAt).toLocaleString()}{manifest.commit ? ` · ${manifest.commit}` : ''} · {hotkey} or Esc to close
            </p>
          )}
        </div>
        <button onClick={onClose} className="rounded border border-gray-400 px-2 py-1 text-sm font-semibold hover:bg-gray-100 dark:hover:bg-gray-800">Close</button>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-3 text-sm">
        {error && <p className="font-semibold text-red-700 dark:text-red-300">{error}</p>}
        {!manifest && !error && <p>Loading…</p>}

        {manifest && !route && (
          <p>
            No page file found for <span className={chip}>{pathname}</span>. This can happen on a page that is not part of the App Router, or if the data was built before this page existed.
          </p>
        )}

        {manifest && route && reach && summary && (
          <>
            <label className="block">
              <span className={heading}>Inspect</span>
              <select
                value={selected ?? ''}
                onChange={(e) => select(e.target.value || null)}
                className="mt-1 block w-full rounded border-2 border-gray-800 bg-white px-2 py-1.5 font-mono text-xs dark:border-gray-500 dark:bg-gray-800"
              >
                <option value="">This screen — {route.pattern}</option>
                {groups.map((g) => (
                  <optgroup key={g.kind} label={`${g.label} (${g.paths.length})`}>
                    {g.paths.map((p) => <option key={p} value={p}>{p}</option>)}
                  </optgroup>
                ))}
              </select>
            </label>

            {selected === null && (
              <div className={section}>
                <p className={heading}>Screen</p>
                <p className="mt-1">URL pattern <span className={chip}>{route.pattern}</span></p>
                <p className="mt-1">Page file {fileLink(route.file)}</p>
                {route.layouts.length > 0 && (
                  <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">Wrapped by {route.layouts.map(fileLink)}</p>
                )}
                <p className="mt-1">{reach.order.length - 1} files are reachable from this screen through imports and API calls.</p>

                <p className={`${heading} ${section}`}>Data this screen touches</p>
                <SummaryList label="Database tables" items={summary.tables} />
                <SummaryList label="Database functions (RPC)" items={summary.rpcs} />
                <SummaryList label="API routes" items={summary.apiRoutes} onSelect={select} known={manifest.files} />
                <SummaryList label="Assets" items={summary.assets} />
                <SummaryList label="Packages" items={summary.packages} />
                <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">
                  Found by static analysis of literal values — a table name or API path built from a variable will not appear.
                </p>
              </div>
            )}

            {file && (
              <div className={section}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className={chip}>{KIND_SINGULAR[file.kind]}</span>
                  <span className={chip}>{file.client ? 'Client component' : file.kind === 'api-route' ? 'Server (API)' : 'No "use client"'}</span>
                  <span className={chip}>{file.lines} lines</span>
                </div>
                <p className="mt-2 break-all font-mono text-xs font-bold">{file.path}</p>

                {file.description && (
                  <p className="mt-2 whitespace-pre-wrap rounded bg-gray-50 p-2 text-xs text-gray-700 dark:bg-gray-800 dark:text-gray-300">{file.description}</p>
                )}

                {chain.length > 1 && (
                  <div className={section}>
                    <p className={heading}>How this screen reaches it</p>
                    <ol className="mt-1 space-y-0.5">
                      {chain.map((p, i) => (
                        <li key={p} style={{ paddingLeft: `${i * 12}px` }} className="flex gap-1">
                          <span className="text-gray-400">{i === 0 ? '▪' : '↳'}</span>{fileLink(p)}
                        </li>
                      ))}
                    </ol>
                  </div>
                )}

                <div className={section}>
                  <p className={heading}>Exports</p>
                  {file.exports.length === 0 ? <p className="mt-1 text-xs text-gray-500">None</p> : (
                    <ul className="mt-1 space-y-0.5">
                      {file.exports.map((x: ExportInfo) => (
                        <li key={`${x.name}:${x.startLine}`} className="flex flex-wrap items-center gap-2">
                          <button onClick={() => openCode(file.path, { start: x.startLine, end: x.endLine })} className={linkBtn}>{x.name}</button>
                          <span className="text-xs text-gray-500">{x.kind} · lines {x.startLine}–{x.endLine}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <FileList title="Imports" items={file.imports} render={fileLink} />
                <FileList title="Imported by" items={file.importedBy} render={fileLink} limit={25} />
                <FileList title="Tests" items={file.tests} render={fileLink} empty="No test file imports this" />
                <FileList title="API routes called" items={file.apiRoutes} render={fileLink} />
                <SummaryList label="Database tables" items={file.tables} />
                <SummaryList label="Database functions (RPC)" items={file.rpcs} />
                <SummaryList label="Assets" items={file.assets} />
                <SummaryList label="Packages" items={file.packages} />

                <button
                  onClick={() => (showCode ? setShowCode(false) : openCode(file.path, null))}
                  className="mt-4 rounded-md border-2 border-gray-800 bg-blue-600 px-3 py-1.5 text-sm font-bold text-white hover:bg-blue-700 dark:border-gray-500"
                >
                  {showCode ? 'Hide code' : 'Show code'}
                </button>
                {showCode && (codeError
                  ? <p className="mt-2 font-semibold text-red-700 dark:text-red-300">{codeError}</p>
                  : source === undefined ? <p className="mt-2">Loading code…</p> : <CodeView text={source} range={range} />)}
              </div>
            )}
          </>
        )}
      </div>
    </aside>
  );
}

function SummaryList({ label, items, onSelect, known }: { label: string; items: string[]; onSelect?: (p: string) => void; known?: Record<string, FileEntry> }) {
  if (items.length === 0) return null;
  return (
    <div className="mt-2">
      <p className="text-xs font-semibold text-gray-700 dark:text-gray-300">{label} ({items.length})</p>
      <div className="mt-1 flex flex-wrap gap-1.5">
        {items.map((item) => (onSelect && known?.[item]
          ? <button key={item} onClick={() => onSelect(item)} className={`${chip} underline`}>{item}</button>
          : <span key={item} className={chip}>{item}</span>))}
      </div>
    </div>
  );
}

function FileList({ title, items, render, limit, empty }: { title: string; items: string[]; render: (p: string) => React.ReactNode; limit?: number; empty?: string }) {
  const [all, setAll] = useState(false);
  if (items.length === 0 && !empty) return null;
  const shown = limit && !all ? items.slice(0, limit) : items;
  return (
    <div className={section}>
      <p className={heading}>{title} ({items.length})</p>
      {items.length === 0 ? <p className="mt-1 text-xs text-gray-500">{empty}</p> : (
        <ul className="mt-1 space-y-0.5">{shown.map((p) => <li key={p}>{render(p)}</li>)}</ul>
      )}
      {limit && items.length > limit && !all && (
        <button onClick={() => setAll(true)} className="mt-1 text-xs font-semibold text-blue-700 underline dark:text-blue-300">Show all {items.length}</button>
      )}
    </div>
  );
}

function CodeView({ text, range }: { text: string; range: { start: number; end: number } | null }) {
  const lines = useMemo(() => text.split('\n'), [text]);
  const firstHighlighted = useRef<HTMLSpanElement | null>(null);
  useEffect(() => { firstHighlighted.current?.scrollIntoView({ block: 'center' }); }, [range, text]);
  const width = String(lines.length).length;
  return (
    <pre className="mt-2 max-h-[60vh] overflow-auto rounded border border-gray-300 bg-gray-50 p-2 font-mono text-[11px] leading-snug dark:border-gray-700 dark:bg-gray-950">
      {lines.map((line, i) => {
        const n = i + 1;
        const hit = range !== null && n >= range.start && n <= range.end;
        return (
          <span
            key={n}
            ref={hit && n === range.start ? firstHighlighted : undefined}
            className={`block whitespace-pre ${hit ? 'bg-yellow-200 dark:bg-yellow-900/60' : ''}`}
          >
            <span className="select-none pr-3 text-gray-400">{String(n).padStart(width, ' ')}</span>{line}
          </span>
        );
      })}
    </pre>
  );
}
