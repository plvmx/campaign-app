import { describe, it, expect, vi, beforeEach } from 'vitest';

const files: Record<string, string> = {};
vi.mock('fs', () => {
  const readFileSync = (p: string) => {
    const name = String(p).split('/').pop() as string;
    if (!(name in files)) throw new Error('ENOENT');
    return files[name];
  };
  return { default: { readFileSync }, readFileSync };
});

describe('manifestStore', () => {
  beforeEach(() => { vi.resetModules(); for (const k of Object.keys(files)) delete files[k]; });

  it('returns null when the generator has not been run', async () => {
    const { loadManifest, loadSource } = await import('../manifestStore');
    expect(loadManifest()).toBeNull();
    expect(loadSource('lib/a.ts')).toBeNull();
  });

  it('serves a source only for an exact key, never inherited object properties', async () => {
    files['manifest.json'] = JSON.stringify({ files: {} });
    files['sources.json'] = JSON.stringify({ 'lib/a.ts': 'const a = 1;' });
    const { loadManifest, loadSource } = await import('../manifestStore');
    expect(loadManifest()).toEqual({ files: {} });
    expect(loadSource('lib/a.ts')).toBe('const a = 1;');
    expect(loadSource('lib/b.ts')).toBeNull();
    expect(loadSource('constructor')).toBeNull();
    expect(loadSource('__proto__')).toBeNull();
  });
});
