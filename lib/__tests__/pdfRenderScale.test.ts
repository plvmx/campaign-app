import { describe, it, expect } from 'vitest';
import { computePdfRenderScale, MAX_RENDER_PIXEL_RATIO } from '../pdfRenderScale';

describe('computePdfRenderScale', () => {
  it('fits the page to the container width', () => {
    expect(computePdfRenderScale(375, 750, 1)).toEqual({ cssScale: 0.5, renderScale: 0.5 });
  });

  it('renders at the screen pixel ratio for sharp text', () => {
    expect(computePdfRenderScale(375, 750, 2).renderScale).toBe(1);
  });

  it('caps the pixel ratio so long guides do not exhaust phone memory', () => {
    expect(computePdfRenderScale(375, 750, 3).renderScale).toBe(0.5 * MAX_RENDER_PIXEL_RATIO);
  });

  it('never renders below 1x, and tolerates a missing pixel ratio', () => {
    expect(computePdfRenderScale(375, 750, 0.5).renderScale).toBe(0.5);
    expect(computePdfRenderScale(375, 750, 0).renderScale).toBe(0.5);
  });

  it('falls back to 1 for a not-yet-laid-out container', () => {
    expect(computePdfRenderScale(0, 750, 2)).toEqual({ cssScale: 1, renderScale: 1 });
  });
});
