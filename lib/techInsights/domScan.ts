/**
 * Tech Insights — finding the components currently on screen. Components opt in
 * by carrying `data-ti="<repo-relative file path>"` on their root element
 * (attribute only: no wrapper, no extra render). The value is a path into the
 * manifest, so it survives minification; a test (tagsMatchSourceFiles) keeps
 * every tag pointing at its own file.
 */

export const TAG_ATTRIBUTE = 'data-ti';

export interface VisibleTag {
  /** Manifest path the tag names. */
  path: string;
  /** Every element currently carrying it, in document order. */
  elements: Element[];
}

/** Tagged elements under `root`, grouped by path in order of first appearance; paths the manifest does not know are dropped. */
export function scanVisibleTags(root: ParentNode, isKnown: (path: string) => boolean): VisibleTag[] {
  const byPath = new Map<string, Element[]>();
  for (const el of root.querySelectorAll(`[${TAG_ATTRIBUTE}]`)) {
    const path = el.getAttribute(TAG_ATTRIBUTE);
    if (!path || !isKnown(path)) continue;
    const list = byPath.get(path);
    if (list) list.push(el); else byPath.set(path, [el]);
  }
  return [...byPath].map(([path, elements]) => ({ path, elements }));
}

/** Tags of `el` and its ancestors, outermost first — "this screen's <MobileLayout> > <CampaignCard> > …". Consecutive repeats collapse. */
export function tagChain(el: Element): string[] {
  const chain: string[] = [];
  for (let cur: Element | null = el; cur; cur = cur.parentElement) {
    const path = cur.getAttribute(TAG_ATTRIBUTE);
    if (path && chain[0] !== path) chain.unshift(path);
  }
  return chain;
}

/** The nearest tagged element at or above `target`, or null. */
export function closestTagged(target: EventTarget | null): Element | null {
  return target instanceof Element ? target.closest(`[${TAG_ATTRIBUTE}]`) : null;
}
