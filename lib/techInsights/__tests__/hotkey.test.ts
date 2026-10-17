import { describe, it, expect } from 'vitest';
import { DEFAULT_TECH_INSIGHTS_HOTKEY, hotkeyFromEvent, matchesHotkey, normalizeHotkey, parseHotkey, type HotkeyEventLike } from '../hotkey';

const ev = (over: Partial<HotkeyEventLike>): HotkeyEventLike =>
  ({ code: 'KeyI', key: 'i', ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...over });

describe('parseHotkey / normalizeHotkey', () => {
  it('accepts valid combinations and canonicalises order and case', () => {
    expect(normalizeHotkey('Ctrl+Alt+I')).toBe('Ctrl+Alt+I');
    expect(normalizeHotkey('shift+alt+ctrl+k')).toBe('Ctrl+Alt+Shift+K');
    expect(normalizeHotkey('Alt+F9')).toBe('Alt+F9');
    expect(normalizeHotkey('Meta+7')).toBe('Meta+7');
  });

  it.each(['', 'I', 'Ctrl', 'Shift+I', 'Ctrl+Ctrl+I', 'Ctrl+Hyper+I', 'Ctrl+II', 'Ctrl+F13', 'Ctrl++', 'Ctrl+Alt+', 'Ctrl+Enter'])(
    'rejects %j', (value) => expect(parseHotkey(value)).toBeNull(),
  );

  it('the default is itself valid and canonical', () => {
    expect(normalizeHotkey(DEFAULT_TECH_INSIGHTS_HOTKEY)).toBe(DEFAULT_TECH_INSIGHTS_HOTKEY);
  });
});

describe('matchesHotkey', () => {
  const hotkey = parseHotkey('Ctrl+Alt+I')!;

  it('matches the exact modifiers and key', () => {
    expect(matchesHotkey(ev({ ctrlKey: true, altKey: true }), hotkey)).toBe(true);
  });

  it('uses the physical key, so Option-style special characters still match', () => {
    expect(matchesHotkey(ev({ ctrlKey: true, altKey: true, key: 'ˆ' }), hotkey)).toBe(true);
  });

  it('rejects missing, extra or wrong modifiers and the wrong key', () => {
    expect(matchesHotkey(ev({ ctrlKey: true }), hotkey)).toBe(false);
    expect(matchesHotkey(ev({ ctrlKey: true, altKey: true, shiftKey: true }), hotkey)).toBe(false);
    expect(matchesHotkey(ev({ ctrlKey: true, altKey: true, code: 'KeyJ' }), hotkey)).toBe(false);
  });

  it('matches F-keys by key name', () => {
    expect(matchesHotkey(ev({ altKey: true, code: 'F9', key: 'F9' }), parseHotkey('Alt+F9')!)).toBe(true);
  });
});

describe('hotkeyFromEvent', () => {
  it('builds the canonical string from a key press', () => {
    expect(hotkeyFromEvent(ev({ ctrlKey: true, shiftKey: true, code: 'Digit4', key: '$' }))).toBe('Ctrl+Shift+4');
  });

  it('returns null for a bare modifier press or an unsupported combination', () => {
    expect(hotkeyFromEvent(ev({ ctrlKey: true, code: 'ControlLeft', key: 'Control' }))).toBeNull();
    expect(hotkeyFromEvent(ev({ shiftKey: true }))).toBeNull();
  });
});
