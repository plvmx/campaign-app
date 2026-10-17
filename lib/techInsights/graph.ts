/**
 * Tech Insights — walking the manifest's dependency graph from a page.
 * Edges are imports plus literal API calls (page → fetch('/api/x') → route file),
 * so "what does this screen ultimately touch" follows data through the server.
 * Test files are never followed.
 */
import type { FileEntry, FileKind, TechInsightsManifest } from './types';

export interface Reach {
  /** file → the file it was first reached from (null for a starting point). */
  parent: Map<string, string | null>;
  /** BFS order, starting points first. */
  order: string[];
}

export function computeReach(roots: readonly string[], manifest: TechInsightsManifest): Reach {
  const parent = new Map<string, string | null>();
  const order: string[] = [];
  const queue: string[] = [];
  for (const r of roots) {
    if (manifest.files[r] && !parent.has(r)) { parent.set(r, null); order.push(r); queue.push(r); }
  }
  while (queue.length > 0) {
    const current = queue.shift() as string;
    const entry = manifest.files[current];
    for (const next of [...entry.imports, ...entry.apiRoutes]) {
      const target = manifest.files[next];
      if (!target || target.kind === 'test' || parent.has(next)) continue;
      parent.set(next, current);
      order.push(next);
      queue.push(next);
    }
  }
  return { parent, order };
}

/** Shortest chain of files from a starting point to `target`, or [] if unreachable. */
export function pathTo(reach: Reach, target: string): string[] {
  if (!reach.parent.has(target)) return [];
  const chain: string[] = [];
  for (let cur: string | null = target; cur !== null; cur = reach.parent.get(cur) ?? null) chain.unshift(cur);
  return chain;
}

export interface DataSummary {
  tables: string[];
  rpcs: string[];
  apiRoutes: string[];
  assets: string[];
  packages: string[];
}

export function summariseReach(reach: Reach, manifest: TechInsightsManifest): DataSummary {
  const sets = { tables: new Set<string>(), rpcs: new Set<string>(), apiRoutes: new Set<string>(), assets: new Set<string>(), packages: new Set<string>() };
  for (const path of reach.order) {
    const f = manifest.files[path];
    f.tables.forEach((t) => sets.tables.add(t));
    f.rpcs.forEach((t) => sets.rpcs.add(t));
    f.apiRoutes.forEach((t) => sets.apiRoutes.add(t));
    f.assets.forEach((t) => sets.assets.add(t));
    f.packages.forEach((t) => sets.packages.add(t));
  }
  const sorted = (s: Set<string>) => [...s].sort();
  return { tables: sorted(sets.tables), rpcs: sorted(sets.rpcs), apiRoutes: sorted(sets.apiRoutes), assets: sorted(sets.assets), packages: sorted(sets.packages) };
}

export const KIND_LABELS: Record<FileKind, string> = {
  page: 'Pages', layout: 'Layouts', 'api-route': 'API routes', component: 'Components', service: 'Services',
  lib: 'Libraries', context: 'Contexts', middleware: 'Middleware', test: 'Tests', style: 'Styles', other: 'Other',
};

export const KIND_SINGULAR: Record<FileKind, string> = {
  page: 'Page', layout: 'Layout', 'api-route': 'API route', component: 'Component', service: 'Service',
  lib: 'Library', context: 'Context', middleware: 'Middleware', test: 'Test', style: 'Style', other: 'Other',
};

const KIND_ORDER: FileKind[] = ['page', 'layout', 'component', 'context', 'service', 'lib', 'api-route', 'middleware', 'style', 'other', 'test'];

/** Reached files grouped by kind, in a stable display order. */
export function groupByKind(paths: readonly string[], files: Record<string, FileEntry>): Array<{ kind: FileKind; label: string; paths: string[] }> {
  return KIND_ORDER
    .map((kind) => ({ kind, label: KIND_LABELS[kind], paths: paths.filter((p) => files[p]?.kind === kind).sort() }))
    .filter((g) => g.paths.length > 0);
}
