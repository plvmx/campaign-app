import { describe, it, expect, afterEach } from 'vitest';
import { closestTagged, scanVisibleTags, tagChain } from '../domScan';

const mount = (html: string) => {
  const host = document.createElement('div');
  host.innerHTML = html;
  document.body.appendChild(host);
  return host;
};

afterEach(() => { document.body.innerHTML = ''; });

describe('scanVisibleTags', () => {
  it('groups elements by path in order of first appearance, with counts per path', () => {
    const host = mount(`
      <div data-ti="components/A.tsx">
        <div data-ti="components/B.tsx"></div>
        <div data-ti="components/B.tsx"></div>
      </div>
      <p data-ti="components/C.tsx"></p>`);
    const tags = scanVisibleTags(host, () => true);
    expect(tags.map((t) => [t.path, t.elements.length])).toEqual([
      ['components/A.tsx', 1], ['components/B.tsx', 2], ['components/C.tsx', 1],
    ]);
  });

  it('drops tags the manifest does not know and empty tags', () => {
    const host = mount(`<div data-ti="components/Gone.tsx"></div><div data-ti=""></div><div data-ti="components/A.tsx"></div>`);
    expect(scanVisibleTags(host, (p) => p === 'components/A.tsx').map((t) => t.path)).toEqual(['components/A.tsx']);
  });

  it('returns nothing when no component is tagged', () => {
    expect(scanVisibleTags(mount('<div><span></span></div>'), () => true)).toEqual([]);
  });
});

describe('tagChain', () => {
  it('lists tagged ancestors outermost first, collapsing adjacent repeats and skipping untagged ones', () => {
    const host = mount(`
      <div data-ti="components/Layout.tsx"><section>
        <div data-ti="components/Card.tsx"><div data-ti="components/Card.tsx"><b id="leaf" data-ti="components/Button.tsx"></b></div></div>
      </section></div>`);
    expect(tagChain(host.querySelector('#leaf') as Element)).toEqual([
      'components/Layout.tsx', 'components/Card.tsx', 'components/Button.tsx',
    ]);
  });
});

describe('closestTagged', () => {
  it('finds the nearest tagged element at or above the target', () => {
    const host = mount(`<div data-ti="components/A.tsx"><span id="inner"><i id="deep"></i></span></div><p id="loose"></p>`);
    expect(closestTagged(host.querySelector('#deep'))?.getAttribute('data-ti')).toBe('components/A.tsx');
    expect(closestTagged(host.querySelector('#loose'))).toBeNull();
    expect(closestTagged(null)).toBeNull();
  });
});
