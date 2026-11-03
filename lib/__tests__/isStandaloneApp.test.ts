import { describe, it, expect } from 'vitest';
import { isStandaloneApp } from '../isStandaloneApp';

describe('isStandaloneApp', () => {
  it('is true for an iPhone home-screen app (navigator.standalone)', () => {
    expect(isStandaloneApp({ navigator: { standalone: true } })).toBe(true);
  });

  it('is true when the display-mode media query matches (Android / desktop PWA)', () => {
    expect(isStandaloneApp({ matchMedia: () => ({ matches: true }) })).toBe(true);
  });

  it('is false in an ordinary browser tab', () => {
    expect(isStandaloneApp({ navigator: { standalone: false }, matchMedia: () => ({ matches: false }) })).toBe(false);
    expect(isStandaloneApp({})).toBe(false);
  });

  it('is false when there is no window (server render)', () => {
    expect(isStandaloneApp(undefined)).toBe(false);
  });
});
