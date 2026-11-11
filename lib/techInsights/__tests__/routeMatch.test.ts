import { describe, it, expect } from 'vitest';
import { matchRoute, routeFromFilePath } from '../routeMatch';
import type { RouteEntry } from '../types';

const page = (pattern: string): RouteEntry => ({ pattern, kind: 'page', file: `app${pattern}/page.tsx`, layouts: [], methods: [] });

describe('routeFromFilePath', () => {
  it.each([
    ['app/page.tsx', '/'],
    ['app/admin/state-leaders/page.tsx', '/admin/state-leaders'],
    ['app/(marketing)/about/page.tsx', '/about'],
    ['app/training-interest/[campaignId]/page.tsx', '/training-interest/[campaignId]'],
    ['app/api/admin/x/route.ts', '/api/admin/x'],
  ])('%s → %s', (file, route) => expect(routeFromFilePath(file)).toBe(route));

  it('returns null for non-route files', () => {
    expect(routeFromFilePath('app/admin/components/Card.tsx')).toBeNull();
    expect(routeFromFilePath('lib/a.ts')).toBeNull();
  });
});

describe('matchRoute', () => {
  const routes = [page('/'), page('/admin'), page('/admin/new'), page('/admin/[id]'), page('/docs/[...slug]'), page('/training-interest/[campaignId]')];

  it('matches the root and static pages', () => {
    expect(matchRoute('/', routes)?.pattern).toBe('/');
    expect(matchRoute('/admin', routes)?.pattern).toBe('/admin');
    expect(matchRoute('/admin/', routes)?.pattern).toBe('/admin');
  });

  it('prefers a static segment over a dynamic one', () => {
    expect(matchRoute('/admin/new', routes)?.pattern).toBe('/admin/new');
    expect(matchRoute('/admin/42', routes)?.pattern).toBe('/admin/[id]');
  });

  it('matches dynamic and catch-all segments, ignoring query and hash', () => {
    expect(matchRoute('/training-interest/abc?x=1#y', routes)?.pattern).toBe('/training-interest/[campaignId]');
    expect(matchRoute('/docs/a/b/c', routes)?.pattern).toBe('/docs/[...slug]');
    expect(matchRoute('/docs', routes)).toBeNull();
  });

  it('returns null for an unknown path or one with extra segments', () => {
    expect(matchRoute('/nowhere', routes)).toBeNull();
    expect(matchRoute('/admin/1/2', routes)).toBeNull();
  });

  it('only matches the requested kind', () => {
    const api: RouteEntry = { pattern: '/api/x', kind: 'api', file: 'app/api/x/route.ts', layouts: [], methods: ['GET'] };
    expect(matchRoute('/api/x', [api])).toBeNull();
    expect(matchRoute('/api/x', [api], 'api')).toBe(api);
  });
});
