/**
 * Older leaders with reading difficulties are the people these screens exist
 * for, so the shared styling must stay large (Peter, 2026-10-14). If you need
 * to change these, make them bigger, not smaller.
 */
import { describe, it, expect } from 'vitest';
import {
  bodyTextClass, headingClass, primaryButtonClass, secondaryButtonClass, inputClass, labelClass, errorBannerClass,
} from '../CodeEntryScreen';

const SIZE_ORDER = ['xs', 'sm', 'base', 'lg', 'xl', '2xl', '3xl', '4xl'];
function sizeOf(classes: string): number {
  const m = classes.match(/(?:^|\s)text-(xs|sm|base|lg|xl|2xl|3xl|4xl)(?:\s|$)/);
  if (!m) throw new Error(`no text size in: ${classes}`);
  return SIZE_ORDER.indexOf(m[1]);
}
const atLeast = (classes: string, min: string) => expect(sizeOf(classes)).toBeGreaterThanOrEqual(SIZE_ORDER.indexOf(min));

describe('setup-screen text sizes', () => {
  it('keeps body text at least 20px', () => atLeast(bodyTextClass, 'xl'));
  it('keeps headings at least 30px', () => atLeast(headingClass, '3xl'));
  it('keeps button text at least 20px', () => atLeast(primaryButtonClass, 'xl'));
  it('keeps links/secondary buttons at least 18px', () => atLeast(secondaryButtonClass, 'lg'));
  it('keeps typed text in boxes at least 24px', () => atLeast(inputClass, '2xl'));
  it('keeps labels and error messages at least 18px', () => {
    atLeast(labelClass, 'lg');
    atLeast(errorBannerClass, 'lg');
  });
});
