'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { fetchTechInsightsManifest, fetchTechInsightsSource } from '@/lib/techInsights/client';
import { computeReach, groupByKind, pathTo, summariseReach, KIND_SINGULAR } from '@/lib/techInsights/graph';
import { matchRoute } from '@/lib/techInsights/routeMatch';
import { closestTagged, scanVisibleTags, tagChain, type VisibleTag } from '@/lib/techInsights/domScan';
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
  // Bumped to re-read which tagged components are on screen (navigation, a modal opening, the drop-down being opened).
  const [scanTick, setScanTick] = useState(0);
  const [visible, setVisible] = useState<VisibleTag[]>([]);
  const [picking, setPicking] = useState(false);
  const [hovered, setHovered] = useState<Element | null>(null);

  useEffect(() => {
    if (cachedManifest) return;
    let cancelled = false;
    fetchTechInsightsManifest()
      .then((m) => { cachedManifest = m; if (!cancelled) setManifest(m); })
      .catch((err: unknown) => { if (!cancelled) setError(getErrorMessage(err, 'Could not load Tech Insights data')); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (picking) setPicking(false); else onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, picking]);

  // "Pick on screen": hover outlines the nearest tagged component, a click selects it (and is swallowed, so the page does nothing).
  useEffect(() => {
    if (!picking || !manifest) return;
    const outsidePanel = (target: EventTarget | null) => !(target instanceof Element && target.closest('[aria-label="Tech Insights"]'));
    const known = (el: Element | null): el is Element => el !== null && Boolean(manifest.files[el.getAttribute('data-ti') ?? '']);
    const onMove = (e: MouseEvent) => {
      const el = outsidePanel(e.target) ? closestTagged(e.target) : null;
      setHovered(known(el) ? el : null);
    };
    const onClick = (e: MouseEvent) => {
      if (!outsidePanel(e.target)) return;
      e.preventDefault();
      e.stopPropagation();
      const el = closestTagged(e.target);
      if (known(el)) {
        setSelected(el.getAttribute('data-ti'));
        setShowCode(false);
        setRange(null);
        setCodeError(null);
        setScanTick((t) => t + 1);
      }
      setPicking(false);
    };
    document.addEventListener('mousemove', onMove, true);
    document.addEventListener('click', onClick, true);
    return () => {
      document.removeEventListener('mousemove', onMove, true);
      document.removeEventListener('click', onClick, true);
      setHovered(null);
    };
  }, [picking, manifest]);

  // Re-scan a frame after the page (or manifest) changes, so the new DOM has committed.
  useEffect(() => {
    if (!manifest) return;
    const frame = requestAnimationFrame(() => setVisible(scanVisibleTags(document, (p) => Boolean(manifest.files[p]))));
    return () => cancelAnimationFrame(frame);
  }, [manifest, pathname, scanTick]);

  const route = useMemo(() => (manifest ? matchRoute(pathname, manifest.routes) : null), [manifest, pathname]);
  const reach = useMemo(() => (manifest && route ? computeReach([route.file, ...route.layouts], manifest) : null), [manifest, route]);
  const summary = useMemo(() => (manifest && reach ? summariseReach(reach, manifest) : null), [manifest, reach]);
  const groups = useMemo(() => (manifest && reach ? groupByKind(reach.order, manifest.files) : []), [manifest, reach]);

  const visiblePaths = useMemo(() => new Set(visible.map((v) => v.path)), [visible]);

  const selectedElements = useMemo(
    () => (selected ? visible.find((v) => v.path === selected)?.elements ?? [] : []),
    [visible, selected],
  );

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
                onMouseDown={() => setScanTick((t) => t + 1)}
                onChange={(e) => select(e.target.value || null)}
                className="mt-1 block w-full rounded border-2 border-gray-800 bg-white px-2 py-1.5 font-mono text-xs dark:border-gray-500 dark:bg-gray-800"
              >
                <option value="">This screen — {route.pattern}</option>
                {visible.length > 0 && (
                  <optgroup label={`Visible on this screen (${visible.length})`}>
                    {visible.map((v) => (
                      <option key={v.path} value={v.path}>{v.path}{v.elements.length > 1 ? ` ×${v.elements.length}` : ''}</option>
                    ))}
                  </optgroup>
                )}
                {groups.map((g) => {
                  const rest = g.paths.filter((p) => !visiblePaths.has(p));
                  return rest.length === 0 ? null : (
                    <optgroup key={g.kind} label={`${g.label} (${rest.length})`}>
                      {rest.map((p) => <option key={p} value={p}>{p}</option>)}
                    </optgroup>
                  );
                })}
              </select>
            </label>

            <button
              onClick={() => setPicking((p) => !p)}
              className={`mt-2 rounded border-2 px-2 py-1 text-xs font-bold ${picking ? 'border-blue-700 bg-blue-600 text-white' : 'border-gray-800 hover:bg-gray-100 dark:border-gray-500 dark:hover:bg-gray-800'}`}
            >
              {picking ? 'Click a component on the page… (Esc to cancel)' : 'Pick on screen'}
            </button>

            {selected === null && (
              <div className={section}>
                <p className={heading}>Screen</p>
                <p className="mt-1">URL pattern <span className={chip}>{route.pattern}</span></p>
                <p className="mt-1">Page file {fileLink(route.file)}</p>
                {route.layouts.length > 0 && (
                  <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">Wrapped by {route.layouts.map(fileLink)}</p>
                )}
                <p className="mt-1">{reach.order.length - 1} files are reachable from this screen through imports and API calls.</p>

                <SummaryList label="Components visible on this screen" items={visible.map((v) => v.path)} onSelect={select} known={manifest.files} />

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

                {selected !== null && selectedElements.length > 0 && (
                  <div className={section}>
                    <p className={heading}>Where it appears on this screen</p>
                    <p className="mt-1 text-xs">{selectedElements.length === 1 ? 'Shown once' : `Shown ${selectedElements.length} times`} — outlined on the page.</p>
                    <p className="mt-1 flex flex-wrap items-center gap-1 text-xs">
                      {tagChain(selectedElements[0]).map((p, i) => (
                        <span key={p} className="flex items-center gap-1">{i > 0 && <span className="text-gray-400">›</span>}{fileLink(p)}</span>
                      ))}
                    </p>
                  </div>
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
      <HighlightBoxes elements={hovered ? [hovered] : selectedElements} />
    </aside>
  );
}

/** Outlines elements on the page; positions follow scrolling and resizing. */
function HighlightBoxes({ elements }: { elements: Element[] }) {
  const [rects, setRects] = useState<DOMRect[]>([]);
  useEffect(() => {
    const measure = () => setRects(elements.filter((el) => el.isConnected).map((el) => el.getBoundingClientRect()));
    const frame = requestAnimationFrame(measure);
    window.addEventListener('scroll', measure, true);
    window.addEventListener('resize', measure);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', measure, true);
      window.removeEventListener('resize', measure);
    };
  }, [elements]);
  return (
    <>
      {rects.map((r, i) => (
        <div
          key={i}
          aria-hidden
          className="pointer-events-none fixed z-[2999] rounded-sm outline outline-2 outline-offset-2 outline-blue-600 bg-blue-500/10"
          style={{ left: r.left, top: r.top, width: r.width, height: r.height }}
        />
      ))}
    </>
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
