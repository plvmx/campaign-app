import { describe, it, expect } from 'vitest';
import { buildManifest, classifyFile, resolveImport } from '../buildManifest';

const build = (files: Record<string, string>, publicAssets: string[] = []) =>
  buildManifest({
    files: Object.entries(files).map(([path, text]) => ({ path, text })),
    publicAssets,
    generatedAt: '2026-10-16T00:00:00.000Z',
    commit: 'abc1234',
  });

describe('classifyFile', () => {
  it.each([
    ['app/admin/page.tsx', 'page'],
    ['app/layout.tsx', 'layout'],
    ['app/api/x/route.ts', 'api-route'],
    ['app/admin/components/Card.tsx', 'component'],
    ['components/Modal.tsx', 'component'],
    ['lib/services/a.ts', 'service'],
    ['lib/a.ts', 'lib'],
    ['lib/__tests__/a.test.ts', 'test'],
    ['contexts/UserContext.tsx', 'context'],
    ['middleware.ts', 'middleware'],
    ['app/globals.css', 'style'],
  ])('%s → %s', (path, kind) => expect(classifyFile(path)).toBe(kind));
});

describe('resolveImport', () => {
  const known = new Set(['lib/a.ts', 'lib/dir/index.ts', 'components/B.tsx']);
  it('resolves @/ aliases, relative paths and index files; ignores packages', () => {
    expect(resolveImport('app/x/page.tsx', '@/lib/a', known)).toBe('lib/a.ts');
    expect(resolveImport('lib/z.ts', './a', known)).toBe('lib/a.ts');
    expect(resolveImport('lib/services/z.ts', '../dir', known)).toBe('lib/dir/index.ts');
    expect(resolveImport('app/x/page.tsx', '@/components/B', known)).toBe('components/B.tsx');
    expect(resolveImport('lib/z.ts', 'react', known)).toBeNull();
    expect(resolveImport('lib/z.ts', './missing', known)).toBeNull();
  });
});

describe('buildManifest', () => {
  const files = {
    'app/layout.tsx': `export default function Root() { return null; }`,
    'app/admin/layout.tsx': `export default function AdminLayout() { return null; }`,
    'app/admin/(group)/thing/page.tsx': `'use client';
/**
 * The thing page — shows things.
 */
import { useState } from 'react';
import Card from '@/components/Card';
import { getThings } from '@/lib/services/thingService';
import './thing.css';
export default function ThingPage() {
  fetch('/api/things/123?x=1');
  fetch(\`/api/things/\${id}\`);
  fetch('/api/nope');
  return <img src="/icons/a.png" />;
}`,
    'app/admin/(group)/thing/thing.css': `.a{}`,
    'components/Card.tsx': `export function Card() { return null; }\nexport default Card;`,
    'lib/services/thingService.ts': `import { supabase } from '@/lib/supabaseClient';
export interface Thing { id: string }
export const LIMIT = 5;
export async function getThings() {
  await supabase.from('things').select('*');
  await supabase.schema('registry').from('registrants').select('*');
  await supabase.storage.from('bucket').list();
  await supabase.rpc('do_it');
  Array.from('abc');
}`,
    'lib/supabaseClient.ts': `export const supabase = null as any;`,
    'app/api/things/[id]/route.ts': `export async function GET() {}\nexport async function POST() {}\nexport const dynamic = 'force-dynamic';`,
    'lib/services/__tests__/thingService.test.ts': `import { getThings } from '../thingService';`,
  };
  const m = build(files, ['public/icons/a.png']);

  it('derives routes from app/ conventions, ignoring route groups', () => {
    const page = m.routes.find((r) => r.file === 'app/admin/(group)/thing/page.tsx');
    expect(page).toMatchObject({ pattern: '/admin/thing', kind: 'page', layouts: ['app/layout.tsx', 'app/admin/layout.tsx'] });
    expect(m.routes.find((r) => r.kind === 'api')).toMatchObject({ pattern: '/api/things/[id]', methods: ['GET', 'POST'] });
  });

  it('records the page directive, description, imports, packages and styles', () => {
    const f = m.files['app/admin/(group)/thing/page.tsx'];
    expect(f.client).toBe(true);
    expect(f.description).toBe('The thing page — shows things.');
    expect(f.imports).toEqual(['components/Card.tsx', 'lib/services/thingService.ts']);
    expect(f.packages).toEqual(['react']);
    expect(f.assets).toEqual(['app/admin/(group)/thing/thing.css', 'public/icons/a.png']);
  });

  it('resolves literal API paths (including template literals) to route files and keeps unmatched ones', () => {
    const f = m.files['app/admin/(group)/thing/page.tsx'];
    expect(f.apiRoutes).toEqual(['app/api/things/[id]/route.ts']);
    expect(f.apiUnresolved).toEqual(['/api/nope']);
  });

  it('finds tables and rpcs, tagging non-public schemas and skipping storage/Array.from', () => {
    const f = m.files['lib/services/thingService.ts'];
    expect(f.tables).toEqual(['registry.registrants', 'things']);
    expect(f.rpcs).toEqual(['do_it']);
  });

  it('records exports with line ranges', () => {
    const f = m.files['lib/services/thingService.ts'];
    expect(f.exports).toEqual([
      { name: 'Thing', kind: 'interface', startLine: 2, endLine: 2 },
      { name: 'LIMIT', kind: 'const', startLine: 3, endLine: 3 },
      { name: 'getThings', kind: 'function', startLine: 4, endLine: 10 },
    ]);
    expect(m.files['components/Card.tsx'].exports.map((e) => e.name)).toEqual(['Card', 'default']);
  });

  it('links importers and the tests that import a file', () => {
    expect(m.files['lib/services/thingService.ts'].importedBy).toEqual([
      'app/admin/(group)/thing/page.tsx',
      'lib/services/__tests__/thingService.test.ts',
    ]);
    expect(m.files['lib/services/thingService.ts'].tests).toEqual(['lib/services/__tests__/thingService.test.ts']);
    expect(m.files['components/Card.tsx'].tests).toEqual([]);
  });

  it('carries the build metadata', () => {
    expect(m).toMatchObject({ version: 1, generatedAt: '2026-10-16T00:00:00.000Z', commit: 'abc1234' });
  });

  it('does not count an asset-looking string that is not a real public file', () => {
    const r = build({ 'lib/a.ts': `export const x = '/icons/missing.png';` }, ['public/icons/a.png']);
    expect(r.files['lib/a.ts'].assets).toEqual([]);
  });
});
