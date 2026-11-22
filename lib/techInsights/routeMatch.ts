/**
 * Tech Insights — mapping between URLs and Next.js App Router files, and back.
 */
import type { RouteEntry } from './types';

/** 'app/admin/state-leaders/page.tsx' → '/admin/state-leaders'; null if not a route file. */
export function routeFromFilePath(path: string): string | null {
  const m = /^app\/(.*?)\/?(page\.tsx?|route\.ts)$/.exec(path);
  if (!m) return null;
  const segments = m[1].split('/').filter((s) => s && !/^\(.*\)$/.test(s) && !s.startsWith('@'));
  return `/${segments.join('/')}`;
}

function scoreSegment(pattern: string, actual: string): number | null {
  if (/^\[\[?\.\.\./.test(pattern)) return 1;
  if (/^\[.+\]$/.test(pattern)) return 2;
  return pattern === actual ? 3 : null;
}

/**
 * Finds the page route serving a URL pathname: static segments beat dynamic
 * ones, which beat catch-alls. Returns null when nothing matches.
 */
export function matchRoute(pathname: string, routes: readonly RouteEntry[], kind: RouteEntry['kind'] = 'page'): RouteEntry | null {
  const actual = pathname.split('?')[0].split('#')[0].split('/').filter(Boolean);
  let best: { route: RouteEntry; score: number[] } | null = null;
  for (const route of routes) {
    if (route.kind !== kind) continue;
    const pattern = route.pattern.split('/').filter(Boolean);
    const score: number[] = [];
    let ok = true;
    let catchAll = false;
    for (let i = 0; i < pattern.length; i++) {
      if (/^\[\[?\.\.\./.test(pattern[i])) {
        // '[...x]' needs at least one segment here; '[[...x]]' may match none.
        if (actual.length <= i && !pattern[i].startsWith('[[')) ok = false;
        score.push(1);
        catchAll = true;
        break;
      }
      const s = i < actual.length ? scoreSegment(pattern[i], actual[i]) : null;
      if (s === null) { ok = false; break; }
      score.push(s);
    }
    if (ok && !catchAll && actual.length !== pattern.length) ok = false;
    if (!ok) continue;
    if (!best || compareScores(score, best.score) > 0) best = { route, score };
  }
  return best?.route ?? null;
}

function compareScores(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}
