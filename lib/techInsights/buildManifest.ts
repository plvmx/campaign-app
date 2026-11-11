/**
 * Tech Insights — pure manifest builder (no filesystem access, so it is fully
 * unit-testable). scripts/build-tech-insights.ts reads the repo, feeds the
 * text in here and writes the result out. Uses the TypeScript parser only
 * (no type-checking program), so it takes a couple of seconds for the whole app.
 *
 * Static analysis has limits: dynamically computed imports, `.from(variable)`
 * and non-literal '/api/…' strings are invisible to it. Those are simply
 * absent from the result rather than guessed.
 */
import ts from 'typescript';
import { matchRoute, routeFromFilePath } from './routeMatch';
import type { ExportInfo, FileEntry, FileKind, RouteEntry, TechInsightsManifest } from './types';

export interface SourceInput { path: string; text: string }

export interface BuildInput {
  /** Every .ts/.tsx/.css file to analyse, repo-relative with forward slashes. */
  files: SourceInput[];
  /** Files under public/, repo-relative (e.g. 'public/icons/a.png'). */
  publicAssets: string[];
  generatedAt: string;
  commit: string | null;
}

const HTTP_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);
const RESOLVE_EXTENSIONS = ['', '.ts', '.tsx', '.js', '.jsx', '.json', '/index.ts', '/index.tsx'];
const ASSET_LITERAL = /^\/[\w\-./]+\.(png|jpe?g|svg|ico|webp|gif|woff2?|pdf|json|webmanifest)$/i;
const MAX_DESCRIPTION_LENGTH = 800;

export function classifyFile(path: string): FileKind {
  if (/(^|\/)__tests__\//.test(path) || /\.test\.tsx?$/.test(path)) return 'test';
  if (path.endsWith('.css')) return 'style';
  if (path === 'middleware.ts' || path === 'proxy.ts') return 'middleware';
  if (path.startsWith('app/')) {
    const base = path.slice(path.lastIndexOf('/') + 1);
    if (/^page\.tsx?$/.test(base)) return 'page';
    if (/^layout\.tsx?$/.test(base)) return 'layout';
    if (/^route\.ts$/.test(base)) return 'api-route';
    return 'component';
  }
  if (path.startsWith('components/')) return 'component';
  if (path.startsWith('lib/services/')) return 'service';
  if (path.startsWith('contexts/')) return 'context';
  if (path.startsWith('lib/')) return 'lib';
  return 'other';
}

function dirname(path: string): string {
  const i = path.lastIndexOf('/');
  return i === -1 ? '' : path.slice(0, i);
}

/** Resolves './x', '../x' and '@/x' to a known repo path, or null (a package or unknown). */
export function resolveImport(from: string, specifier: string, known: ReadonlySet<string>): string | null {
  let base: string;
  if (specifier.startsWith('@/')) base = specifier.slice(2);
  else if (specifier.startsWith('.')) {
    const parts = dirname(from).split('/').filter(Boolean);
    for (const seg of specifier.split('/')) {
      if (seg === '.' || seg === '') continue;
      if (seg === '..') parts.pop();
      else parts.push(seg);
    }
    base = parts.join('/');
  } else return null;
  for (const ext of RESOLVE_EXTENSIONS) {
    if (known.has(base + ext)) return base + ext;
  }
  return null;
}

function packageName(specifier: string): string {
  const parts = specifier.split('/');
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

function cleanComment(raw: string): string {
  const text = raw
    .replace(/^\/\*+/, '').replace(/\*+\/$/, '')
    .split('\n')
    .map((l) => l.trim().replace(/^\/\/+\s?/, '').replace(/^\*\s?/, ''))
    .join('\n')
    .trim();
  return text.length > MAX_DESCRIPTION_LENGTH ? `${text.slice(0, MAX_DESCRIPTION_LENGTH)}…` : text;
}

function lineOf(sf: ts.SourceFile, pos: number): number {
  return sf.getLineAndCharacterOfPosition(pos).line + 1;
}

function exportKind(node: ts.Node): ExportInfo['kind'] {
  if (ts.isFunctionDeclaration(node)) return 'function';
  if (ts.isClassDeclaration(node)) return 'class';
  if (ts.isInterfaceDeclaration(node)) return 'interface';
  if (ts.isTypeAliasDeclaration(node)) return 'type';
  if (ts.isEnumDeclaration(node)) return 'enum';
  return 'other';
}

function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  return ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some((m) => m.kind === kind);
}

function stringArg(call: ts.CallExpression): string | null {
  const arg = call.arguments[0];
  return arg && (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)) ? arg.text : null;
}

/** Text of a string/template literal with each `${…}` replaced by 'x', or null for any other node. */
function literalText(node: ts.Node): string | null {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isTemplateExpression(node)) {
    return node.head.text + node.templateSpans.map((s) => `x${s.literal.text}`).join('');
  }
  return null;
}

interface RawAnalysis {
  entry: FileEntry;
  apiPaths: string[];
}

function analyse(file: SourceInput, known: ReadonlySet<string>, publicAssets: ReadonlySet<string>): RawAnalysis {
  const kind = classifyFile(file.path);
  const entry: FileEntry = {
    path: file.path, kind, lines: file.text.split('\n').length, client: false, description: null,
    exports: [], imports: [], importedBy: [], tests: [], packages: [], tables: [], rpcs: [],
    apiRoutes: [], apiUnresolved: [], assets: [],
  };
  const apiPaths: string[] = [];
  if (kind === 'style') return { entry, apiPaths };

  const sf = ts.createSourceFile(file.path, file.text, ts.ScriptTarget.Latest, true,
    file.path.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);

  const imports = new Set<string>();
  const packages = new Set<string>();
  const assets = new Set<string>();
  const tables = new Set<string>();
  const rpcs = new Set<string>();

  const addSpecifier = (spec: string) => {
    const resolved = resolveImport(file.path, spec, known);
    if (!resolved) {
      if (!spec.startsWith('.') && !spec.startsWith('@/')) packages.add(packageName(spec));
      return;
    }
    if (classifyFile(resolved) === 'style') assets.add(resolved);
    else imports.add(resolved);
  };

  // Top-level pass: directives, description, imports/exports with line ranges.
  let firstReal: ts.Statement | null = null;
  for (const stmt of sf.statements) {
    if (ts.isExpressionStatement(stmt) && ts.isStringLiteral(stmt.expression)) {
      if (stmt.expression.text === 'use client') entry.client = true;
      continue;
    }
    if (!firstReal) firstReal = stmt;

    if (ts.isImportDeclaration(stmt) && ts.isStringLiteral(stmt.moduleSpecifier)) {
      addSpecifier(stmt.moduleSpecifier.text);
      continue;
    }
    if (ts.isExportDeclaration(stmt)) {
      if (stmt.moduleSpecifier && ts.isStringLiteral(stmt.moduleSpecifier)) addSpecifier(stmt.moduleSpecifier.text);
      continue;
    }
    if (ts.isExportAssignment(stmt)) {
      entry.exports.push({ name: 'default', kind: 'default', startLine: lineOf(sf, stmt.getStart(sf)), endLine: lineOf(sf, stmt.getEnd()) });
      continue;
    }
    if (!hasModifier(stmt, ts.SyntaxKind.ExportKeyword)) continue;
    const isDefault = hasModifier(stmt, ts.SyntaxKind.DefaultKeyword);
    const startLine = lineOf(sf, stmt.getStart(sf));
    const endLine = lineOf(sf, stmt.getEnd());
    if (ts.isVariableStatement(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        if (ts.isIdentifier(decl.name)) entry.exports.push({ name: decl.name.text, kind: 'const', startLine, endLine });
      }
    } else {
      const named = (stmt as ts.Node & { name?: ts.Identifier }).name?.text;
      entry.exports.push({ name: isDefault ? (named ? `default (${named})` : 'default') : (named ?? 'unnamed'), kind: isDefault ? 'default' : exportKind(stmt), startLine, endLine });
    }
  }
  if (firstReal) {
    const ranges = ts.getLeadingCommentRanges(file.text, firstReal.getFullStart());
    if (ranges && ranges.length > 0) {
      // The comment nearest the first statement is the file's own description.
      const nearest = ranges[ranges.length - 1];
      const text = cleanComment(file.text.slice(nearest.pos, nearest.end));
      entry.description = text || null;
    }
  }

  // Whole-tree pass: dynamic imports, Supabase calls, '/api/…' and asset literals.
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        const spec = stringArg(node);
        if (spec) addSpecifier(spec);
      } else if (ts.isPropertyAccessExpression(node.expression)) {
        const method = node.expression.name.text;
        const target = stringArg(node);
        if (target && (method === 'from' || method === 'rpc')) {
          const receiver = node.expression.expression;
          const receiverText = receiver.getText(sf);
          if (!/storage\s*$/.test(receiverText) && !/^Array$/.test(receiverText)) {
            let schema: string | null = null;
            if (ts.isCallExpression(receiver) && ts.isPropertyAccessExpression(receiver.expression) && receiver.expression.name.text === 'schema') {
              schema = stringArg(receiver);
            }
            (method === 'from' ? tables : rpcs).add(schema ? `${schema}.${target}` : target);
          }
        }
      }
    }
    const text = literalText(node);
    if (text !== null) {
      if (text.startsWith('/api/')) apiPaths.push(text.split('?')[0].replace(/\/+$/, ''));
      else if (ASSET_LITERAL.test(text) && publicAssets.has(`public${text}`)) assets.add(`public${text}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);

  entry.imports = [...imports].sort();
  entry.packages = [...packages].sort();
  entry.assets = [...assets].sort();
  entry.tables = [...tables].sort();
  entry.rpcs = [...rpcs].sort();
  return { entry, apiPaths };
}

export function buildManifest(input: BuildInput): TechInsightsManifest {
  const known = new Set(input.files.map((f) => f.path));
  const publicAssets = new Set(input.publicAssets);
  const analysed = input.files
    .slice()
    .sort((a, b) => a.path.localeCompare(b.path))
    .map((f) => analyse(f, known, publicAssets));
  const files: Record<string, FileEntry> = Object.fromEntries(analysed.map((a) => [a.entry.path, a.entry]));

  // Routes, from the app/ directory conventions.
  const routes: RouteEntry[] = [];
  for (const { entry } of analysed) {
    if (entry.kind !== 'page' && entry.kind !== 'api-route') continue;
    const pattern = routeFromFilePath(entry.path);
    if (pattern === null) continue;
    const layouts: string[] = [];
    if (entry.kind === 'page') {
      const segments = dirname(entry.path).split('/');
      for (let i = 1; i <= segments.length; i++) {
        const layout = ['tsx', 'ts'].map((ext) => `${segments.slice(0, i).join('/')}/layout.${ext}`).find((p) => known.has(p));
        if (layout) layouts.push(layout);
      }
    }
    routes.push({
      pattern, kind: entry.kind === 'page' ? 'page' : 'api', file: entry.path, layouts,
      methods: entry.kind === 'api-route' ? entry.exports.map((e) => e.name).filter((n) => HTTP_METHODS.has(n)) : [],
    });
  }
  routes.sort((a, b) => a.pattern.localeCompare(b.pattern));

  // Resolve literal '/api/…' strings to the route files that serve them.
  const apiRoutes = routes.filter((r) => r.kind === 'api');
  for (const { entry, apiPaths } of analysed) {
    const resolved = new Set<string>();
    const unresolved = new Set<string>();
    for (const p of apiPaths) {
      const hit = matchRoute(p, apiRoutes, 'api');
      if (hit) resolved.add(hit.file);
      else unresolved.add(p);
    }
    entry.apiRoutes = [...resolved].sort();
    entry.apiUnresolved = [...unresolved].sort();
  }

  // Reverse edges.
  for (const entry of Object.values(files)) {
    for (const target of entry.imports) {
      const t = files[target];
      if (!t) continue;
      t.importedBy.push(entry.path);
      if (entry.kind === 'test') t.tests.push(entry.path);
    }
  }
  for (const entry of Object.values(files)) {
    entry.importedBy.sort();
    entry.tests.sort();
  }

  return { version: 1, generatedAt: input.generatedAt, commit: input.commit, routes, files };
}
