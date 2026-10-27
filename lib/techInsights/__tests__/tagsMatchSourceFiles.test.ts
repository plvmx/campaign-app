/**
 * A `data-ti="<path>"` tag is the link between a component on screen and the
 * Tech Insights manifest, so it must name the very file it is written in —
 * a copy-pasted or stale value would send a developer to the wrong code.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '../../..');
const DIRS = ['app', 'components', 'contexts', 'lib'];
const TAG = /data-ti="([^"<>{}]+\.tsx?)"/g;

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === 'node_modules' || e.name === '__tests__' ? [] : walk(full);
    return /\.tsx?$/.test(e.name) ? [full] : [];
  });
}

const tagged = DIRS.flatMap((d) => walk(path.join(ROOT, d))).flatMap((full) => {
  const rel = path.relative(ROOT, full).split(path.sep).join('/');
  const values = [...fs.readFileSync(full, 'utf8').matchAll(TAG)].map((m) => m[1]);
  return values.length > 0 ? [{ rel, values }] : [];
});

describe('data-ti tags', () => {
  it('exist (the scan found tagged components)', () => {
    expect(tagged.length).toBeGreaterThan(30);
  });

  it.each(tagged.map((t) => [t.rel, t.values] as const))('%s tags only itself', (rel, values) => {
    expect(new Set(values)).toEqual(new Set([rel]));
  });

  it('every tag points at a real file', () => {
    for (const { values } of tagged) for (const v of values) expect(fs.existsSync(path.join(ROOT, v))).toBe(true);
  });
});
