import { describe, it, expect } from 'vitest';
import { computeReach, groupByKind, pathTo, summariseReach } from '../graph';
import type { FileEntry, FileKind, TechInsightsManifest } from '../types';

const f = (path: string, kind: FileKind, over: Partial<FileEntry> = {}): FileEntry => ({
  path, kind, lines: 1, client: false, description: null, exports: [], imports: [], importedBy: [], tests: [],
  packages: [], tables: [], rpcs: [], apiRoutes: [], apiUnresolved: [], assets: [], ...over,
});

const manifest: TechInsightsManifest = {
  version: 1, generatedAt: '', commit: null, routes: [],
  files: Object.fromEntries([
    f('page', 'page', { imports: ['card', 'client'] }),
    f('card', 'component', { imports: ['svc'], assets: ['public/a.png'], packages: ['react'] }),
    f('client', 'service', { apiRoutes: ['route'] }),
    f('route', 'api-route', { imports: ['svc'], tables: ['things'] }),
    f('svc', 'service', { tables: ['things', 'other'], rpcs: ['r'] }),
    f('t', 'test', { imports: ['svc'] }),
    f('orphan', 'lib'),
  ].map((e) => [e.path, e])),
};

describe('computeReach', () => {
  const reach = computeReach(['page'], manifest);

  it('follows imports and API calls but not tests, and does not revisit', () => {
    expect(reach.order).toEqual(['page', 'card', 'client', 'svc', 'route']);
    expect(reach.parent.has('t')).toBe(false);
    expect(reach.parent.has('orphan')).toBe(false);
  });

  it('records the shortest chain from the page', () => {
    expect(pathTo(reach, 'svc')).toEqual(['page', 'card', 'svc']);
    expect(pathTo(reach, 'route')).toEqual(['page', 'client', 'route']);
    expect(pathTo(reach, 'page')).toEqual(['page']);
    expect(pathTo(reach, 'orphan')).toEqual([]);
  });

  it('ignores starting points the manifest does not know', () => {
    expect(computeReach(['nope'], manifest).order).toEqual([]);
  });
});

describe('summariseReach', () => {
  it('unions what everything reachable touches, sorted and de-duplicated', () => {
    expect(summariseReach(computeReach(['page'], manifest), manifest)).toEqual({
      tables: ['other', 'things'], rpcs: ['r'], apiRoutes: ['route'], assets: ['public/a.png'], packages: ['react'],
    });
  });
});

describe('groupByKind', () => {
  it('groups in a stable kind order and omits empty groups', () => {
    const groups = groupByKind(computeReach(['page'], manifest).order, manifest.files);
    expect(groups.map((g) => [g.kind, g.paths])).toEqual([
      ['page', ['page']], ['component', ['card']], ['service', ['client', 'svc']], ['api-route', ['route']],
    ]);
  });
});
