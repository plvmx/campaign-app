import { describe, it } from 'node:test';
import assert from 'node:assert';
import { applyReportCloneStyles } from '../reportCloneStyles';

function createMockEl(calls: { key: string; value: string }[]): HTMLElement {
  return {
    style: {
      setProperty(key: string, value: string, priority?: string) {
        calls.push({ key, value });
      },
    },
    querySelectorAll() {
      return [];
    },
    querySelector() {
      return null;
    },
  } as unknown as HTMLElement;
}

describe('applyReportCloneStyles', () => {
  it('applies padding-top and padding-bottom to th/td elements', () => {
    const cellCalls: { key: string; value: string }[] = [];
    const cell = createMockEl(cellCalls);
    const rootCalls: { key: string; value: string }[] = [];
    const root = {
      ...createMockEl(rootCalls),
      querySelectorAll(sel: string) {
        if (sel === 'th, td') return [cell];
        return [];
      },
      querySelector() {
        return null;
      },
    } as unknown as HTMLElement;

    applyReportCloneStyles(root);

    assert.strictEqual(cellCalls.some((c) => c.key === 'padding-top' && c.value === '0.25rem'), true);
    assert.strictEqual(cellCalls.some((c) => c.key === 'padding-bottom' && c.value === '0.25rem'), true);
    assert.strictEqual(cellCalls.some((c) => c.key === 'vertical-align' && c.value === 'top'), true);
    assert.strictEqual(rootCalls.some((c) => c.key === 'padding-top' && c.value === '0.5rem'), true);
  });

  it('applies margin-bottom to INDEX div when present', () => {
    const indexCalls: { key: string; value: string }[] = [];
    const indexDiv = createMockEl(indexCalls);
    const root = {
      ...createMockEl([]),
      querySelectorAll() {
        return [];
      },
      querySelector(sel: string) {
        if (sel === '.mb-1') return indexDiv;
        return null;
      },
    } as unknown as HTMLElement;

    applyReportCloneStyles(root);

    assert.strictEqual(indexCalls.some((c) => c.key === 'margin-bottom' && c.value === '0.25rem'), true);
  });
});
