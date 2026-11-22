import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import type { FileEntry, FileKind, TechInsightsManifest } from '@/lib/techInsights/types';

vi.mock('next/navigation', () => ({ usePathname: () => '/admin/things/42' }));

const f = (path: string, kind: FileKind, over: Partial<FileEntry> = {}): FileEntry => ({
  path, kind, lines: 12, client: false, description: null, exports: [], imports: [], importedBy: [], tests: [],
  packages: [], tables: [], rpcs: [], apiRoutes: [], apiUnresolved: [], assets: [], ...over,
});

const manifest: TechInsightsManifest = {
  version: 1, generatedAt: '2026-10-16T00:00:00.000Z', commit: 'abc1234',
  routes: [
    { pattern: '/admin/things/[id]', kind: 'page', file: 'app/admin/things/[id]/page.tsx', layouts: ['app/layout.tsx'], methods: [] },
  ],
  files: Object.fromEntries([
    f('app/admin/things/[id]/page.tsx', 'page', { client: true, description: 'Shows one thing.', imports: ['lib/services/thingService.ts', 'components/Card.tsx'] }),
    f('components/Card.tsx', 'component', { importedBy: ['app/admin/things/[id]/page.tsx'] }),
    f('app/layout.tsx', 'layout'),
    f('lib/services/thingService.ts', 'service', {
      tables: ['things'], importedBy: ['app/admin/things/[id]/page.tsx'], tests: ['lib/services/__tests__/thingService.test.ts'],
      exports: [{ name: 'getThing', kind: 'function', startLine: 2, endLine: 3 }],
    }),
  ].map((e) => [e.path, e])),
};

const mockFetchManifest = vi.fn();
const mockFetchSource = vi.fn();
vi.mock('@/lib/techInsights/client', () => ({
  fetchTechInsightsManifest: () => mockFetchManifest(),
  fetchTechInsightsSource: (p: string) => mockFetchSource(p),
}));

import TechInsightsPanel from '../TechInsightsPanel';

describe('TechInsightsPanel — components on screen', () => {
  const mountPage = (html: string) => {
    const host = document.createElement('div');
    host.innerHTML = html;
    document.body.appendChild(host);
    return host;
  };
  afterEach(() => { document.body.innerHTML = ''; cleanup(); });

  it('lists tagged components that are on screen first, with counts, ignoring unknown tags', async () => {
    mockFetchManifest.mockResolvedValue(manifest);
    mountPage('<div data-ti="components/Card.tsx"></div><div data-ti="components/Card.tsx"></div><div data-ti="components/Gone.tsx"></div>');
    render(<TechInsightsPanel onClose={() => {}} hotkey="Ctrl+Alt+I" />);
    const group = await waitFor(() => {
      const g = document.querySelector('optgroup[label^="Visible on this screen"]');
      if (!g) throw new Error('not yet');
      return g as HTMLElement;
    });
    expect(group.getAttribute('label')).toBe('Visible on this screen (1)');
    expect(group.textContent).toBe('components/Card.tsx ×2');
    // not repeated under the generic "Components" group
    expect(document.querySelector('optgroup[label^="Components"]')).toBeNull();
  });

  it('outlines a selected visible component and shows where it sits in the screen', async () => {
    mockFetchManifest.mockResolvedValue(manifest);
    mountPage('<div data-ti="components/Card.tsx"></div><div data-ti="components/Card.tsx"></div>');
    render(<TechInsightsPanel onClose={() => {}} hotkey="Ctrl+Alt+I" />);
    await waitFor(() => expect(document.querySelector('optgroup[label^="Visible"]')).not.toBeNull());
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'components/Card.tsx' } });
    expect(await screen.findByText('Where it appears on this screen')).toBeTruthy();
    expect(screen.getByText(/Shown 2 times/)).toBeTruthy();
    await waitFor(() => expect(document.querySelectorAll('[aria-hidden].outline-blue-600').length).toBe(2));
  });

  it('"Pick on screen" selects the clicked component and swallows the click', async () => {
    mockFetchManifest.mockResolvedValue(manifest);
    const host = mountPage('<div data-ti="components/Card.tsx"><button id="inner">Do it</button></div>');
    const pageClick = vi.fn();
    (host.querySelector('#inner') as Element).addEventListener('click', pageClick);
    render(<TechInsightsPanel onClose={() => {}} hotkey="Ctrl+Alt+I" />);
    await screen.findByText('/admin/things/[id]');
    fireEvent.click(screen.getByText('Pick on screen'));
    fireEvent.click(host.querySelector('#inner') as Element);
    expect(await screen.findByText('Where it appears on this screen')).toBeTruthy();
    expect(pageClick).not.toHaveBeenCalled();
    // picking mode ended: the next click reaches the page again
    fireEvent.click(host.querySelector('#inner') as Element);
    expect(pageClick).toHaveBeenCalledTimes(1);
  });

  it('Escape cancels picking instead of closing the panel', async () => {
    mockFetchManifest.mockResolvedValue(manifest);
    const onClose = vi.fn();
    render(<TechInsightsPanel onClose={onClose} hotkey="Ctrl+Alt+I" />);
    await screen.findByText('/admin/things/[id]');
    fireEvent.click(screen.getByText('Pick on screen'));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('TechInsightsPanel', () => {
  beforeAll(() => {
    // jsdom has no scrollIntoView.
    Element.prototype.scrollIntoView = vi.fn();
  });
  afterEach(cleanup);

  it('shows the screen overview: matched route, page file, layouts and the data it touches', async () => {
    mockFetchManifest.mockResolvedValue(manifest);
    render(<TechInsightsPanel onClose={() => {}} hotkey="Ctrl+Alt+I" />);
    expect(await screen.findByText('/admin/things/[id]')).toBeTruthy();
    expect(screen.getAllByText('app/admin/things/[id]/page.tsx').length).toBeGreaterThan(0);
    expect(screen.getByText('Shows one thing.')).toBeTruthy();
    expect(screen.getByText('things')).toBeTruthy(); // table reached through the service
    expect(screen.getByText(/Built/).textContent).toContain('abc1234');
  });

  it('lists reachable files in the drop-down and shows details when one is picked', async () => {
    mockFetchManifest.mockResolvedValue(manifest);
    render(<TechInsightsPanel onClose={() => {}} hotkey="Ctrl+Alt+I" />);
    await screen.findByText('/admin/things/[id]');
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'lib/services/thingService.ts' } });
    expect(await screen.findByText('How this screen reaches it')).toBeTruthy();
    expect(screen.getByText('getThing')).toBeTruthy();
    expect(screen.getByText('lib/services/__tests__/thingService.test.ts')).toBeTruthy();
  });

  it('loads and shows source on demand, highlighting an export\'s lines', async () => {
    mockFetchManifest.mockResolvedValue(manifest);
    mockFetchSource.mockResolvedValue('import x from "y";\nexport function getThing() {\n  return 1;\n}\n');
    const { container } = render(<TechInsightsPanel onClose={() => {}} hotkey="Ctrl+Alt+I" />);
    await screen.findByText('/admin/things/[id]');
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'lib/services/thingService.ts' } });
    fireEvent.click(await screen.findByText('getThing'));
    await waitFor(() => expect(mockFetchSource).toHaveBeenCalledWith('lib/services/thingService.ts'));
    await waitFor(() => expect(container.querySelectorAll('pre span.bg-yellow-200').length).toBe(2));
  });

  it('shows the server\'s message when the data cannot be loaded', async () => {
    // Cached manifest from the earlier tests is module-level; this checks the error path only when there is none.
    vi.resetModules();
    const { default: Fresh } = await import('../TechInsightsPanel');
    mockFetchManifest.mockRejectedValue(new Error('Forbidden'));
    render(<Fresh onClose={() => {}} hotkey="Ctrl+Alt+I" />);
    expect(await screen.findByText('Forbidden')).toBeTruthy();
  });

  it('closes with the Close button', async () => {
    mockFetchManifest.mockResolvedValue(manifest);
    const onClose = vi.fn();
    render(<TechInsightsPanel onClose={onClose} hotkey="Ctrl+Alt+I" />);
    fireEvent.click(screen.getByText('Close'));
    expect(onClose).toHaveBeenCalled();
  });
});
