/**
 * Tech Insights — builds generated/tech-insights/{manifest,sources}.json from
 * the repo's own source (see lib/techInsights/buildManifest.ts). Runs
 * automatically before `npm run dev` and `npm run build`; the output is
 * gitignored and only ever served through the admin-only API route
 * (app/api/admin/tech-insights), never from public/.
 *
 * Usage: npx tsx scripts/build-tech-insights.ts
 */
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { buildManifest } from '../lib/techInsights/buildManifest';

const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'generated', 'tech-insights');
const SOURCE_DIRS = ['app', 'components', 'contexts', 'lib'];
const SOURCE_ROOT_FILES = ['middleware.ts', 'proxy.ts'];
const SOURCE_EXT = /\.(tsx?|css)$/;
const SKIP_DIRS = new Set(['node_modules', '.next', '.git', 'generated']);
// A few huge files would bloat the API function for little value; the cut-off is visible in the panel.
const MAX_SOURCE_CHARS = 300_000;

function walk(dir: string, accept: (file: string) => boolean): string[] {
  const out: string[] = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full, accept));
    else if (accept(entry.name)) out.push(full);
  }
  return out;
}

const rel = (full: string) => path.relative(ROOT, full).split(path.sep).join('/');

function currentCommit(): string | null {
  if (process.env.VERCEL_GIT_COMMIT_SHA) return process.env.VERCEL_GIT_COMMIT_SHA.slice(0, 7);
  try {
    return execSync('git rev-parse --short HEAD', { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return null;
  }
}

const sourcePaths = [
  ...SOURCE_DIRS.flatMap((d) => walk(path.join(ROOT, d), (n) => SOURCE_EXT.test(n))),
  ...SOURCE_ROOT_FILES.map((f) => path.join(ROOT, f)).filter((f) => fs.existsSync(f)),
].map(rel);

const files = sourcePaths.map((p) => ({ path: p, text: fs.readFileSync(path.join(ROOT, p), 'utf8') }));
const publicAssets = walk(path.join(ROOT, 'public'), () => true).map(rel);

const manifest = buildManifest({ files, publicAssets, generatedAt: new Date().toISOString(), commit: currentCommit() });
const sources = Object.fromEntries(files.map((f) => [
  f.path,
  f.text.length > MAX_SOURCE_CHARS ? `${f.text.slice(0, MAX_SOURCE_CHARS)}\n/* … file truncated by Tech Insights (over ${MAX_SOURCE_CHARS} characters) … */\n` : f.text,
]));

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(path.join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest));
fs.writeFileSync(path.join(OUT_DIR, 'sources.json'), JSON.stringify(sources));
console.log(`Tech Insights: ${files.length} files, ${manifest.routes.length} routes → ${rel(OUT_DIR)}`);
