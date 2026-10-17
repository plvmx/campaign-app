/**
 * Tech Insights — server-side access to the generated manifest and sources
 * (scripts/build-tech-insights.ts). Read from disk lazily and cached for the
 * life of the server instance. The route that serves these is next.config.ts's
 * outputFileTracingIncludes entry's counterpart: without it Vercel would not
 * ship the generated files with the function.
 */
import fs from 'fs';
import path from 'path';
import type { TechInsightsManifest, TechInsightsSources } from './types';

const DIR = path.join(process.cwd(), 'generated', 'tech-insights');

let manifestCache: TechInsightsManifest | null = null;
let sourcesCache: TechInsightsSources | null = null;

function readJson<T>(name: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(DIR, name), 'utf8')) as T;
  } catch {
    return null;
  }
}

/** null when the generator hasn't been run (run `npm run tech-insights`). */
export function loadManifest(): TechInsightsManifest | null {
  manifestCache ??= readJson<TechInsightsManifest>('manifest.json');
  return manifestCache;
}

/** Source text for a path the manifest knows about; arbitrary paths are never read from disk. */
export function loadSource(filePath: string): string | null {
  sourcesCache ??= readJson<TechInsightsSources>('sources.json');
  if (!sourcesCache || !Object.prototype.hasOwnProperty.call(sourcesCache, filePath)) return null;
  return sourcesCache[filePath];
}
