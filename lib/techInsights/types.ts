/**
 * Tech Insights — shapes shared by the build-time manifest generator
 * (buildManifest.ts), the admin-only API route and the on-screen panel.
 * Plain data only, so this file is safe to import from client code.
 */

export type FileKind =
  | 'page' | 'layout' | 'api-route' | 'component' | 'service'
  | 'lib' | 'context' | 'middleware' | 'test' | 'style' | 'other';

export interface ExportInfo {
  name: string;
  kind: 'function' | 'class' | 'const' | 'type' | 'interface' | 'enum' | 'default' | 'other';
  startLine: number;
  endLine: number;
}

export interface FileEntry {
  path: string;
  kind: FileKind;
  lines: number;
  /** Has a 'use client' directive. */
  client: boolean;
  /** The file's own leading comment, cleaned up — the closest thing to a plain-language description. */
  description: string | null;
  exports: ExportInfo[];
  /** Local files this file imports (resolved repo-relative paths). */
  imports: string[];
  importedBy: string[];
  /** Test files that import this file. */
  tests: string[];
  /** npm packages imported. */
  packages: string[];
  /** Supabase tables read/written via `.from('…')`, `registry.x` for other schemas. */
  tables: string[];
  rpcs: string[];
  /** API route files this file calls via a literal '/api/…' path. */
  apiRoutes: string[];
  /** '/api/…' paths this file mentions that matched no route file. */
  apiUnresolved: string[];
  /** Static assets (public/ files or imported css/images) this file references. */
  assets: string[];
}

export interface RouteEntry {
  /** URL pattern, e.g. '/training-interest/[campaignId]'. */
  pattern: string;
  kind: 'page' | 'api';
  file: string;
  /** Layout files that wrap a page, outermost first. */
  layouts: string[];
  /** HTTP methods exported (api routes only). */
  methods: string[];
}

export interface TechInsightsManifest {
  version: 1;
  generatedAt: string;
  commit: string | null;
  routes: RouteEntry[];
  files: Record<string, FileEntry>;
}

/** Source text keyed by repo-relative path; served one file at a time. */
export type TechInsightsSources = Record<string, string>;
