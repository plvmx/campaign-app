/**
 * Tech Insights — the configurable keyboard shortcut. Stored as a canonical
 * string such as 'Ctrl+Alt+I' (modifier order: Ctrl, Alt, Shift, Meta).
 */
export const DEFAULT_TECH_INSIGHTS_HOTKEY = 'Ctrl+Alt+I';

export interface ParsedHotkey { ctrl: boolean; alt: boolean; shift: boolean; meta: boolean; key: string }

/** The slice of KeyboardEvent we read — lets tests pass plain objects. */
export interface HotkeyEventLike { code: string; key: string; ctrlKey: boolean; altKey: boolean; shiftKey: boolean; metaKey: boolean }

const KEY_PATTERN = /^([A-Z]|[0-9]|F([1-9]|1[0-2]))$/;

/** Parses 'Ctrl+Alt+I'. Needs at least one of Ctrl/Alt/Meta (Shift alone would clash with typing) and exactly one key (A–Z, 0–9, F1–F12). */
export function parseHotkey(value: string): ParsedHotkey | null {
  const parts = value.split('+').map((p) => p.trim());
  if (parts.length < 2 || parts.some((p) => !p)) return null;
  const key = parts[parts.length - 1].toUpperCase();
  if (!KEY_PATTERN.test(key)) return null;
  const mods = new Set(parts.slice(0, -1).map((p) => p.toLowerCase()));
  const known = new Set(['ctrl', 'alt', 'shift', 'meta']);
  if (mods.size !== parts.length - 1 || [...mods].some((m) => !known.has(m))) return null;
  if (!mods.has('ctrl') && !mods.has('alt') && !mods.has('meta')) return null;
  return { ctrl: mods.has('ctrl'), alt: mods.has('alt'), shift: mods.has('shift'), meta: mods.has('meta'), key };
}

export function formatHotkey(h: ParsedHotkey): string {
  return [h.ctrl && 'Ctrl', h.alt && 'Alt', h.shift && 'Shift', h.meta && 'Meta', h.key].filter(Boolean).join('+');
}

/** Canonical form of a valid hotkey string, or null. */
export function normalizeHotkey(value: string): string | null {
  const parsed = parseHotkey(value);
  return parsed ? formatHotkey(parsed) : null;
}

function eventKey(e: HotkeyEventLike): string | null {
  if (/^Key[A-Z]$/.test(e.code)) return e.code.slice(3);
  if (/^Digit[0-9]$/.test(e.code)) return e.code.slice(5);
  if (/^F([1-9]|1[0-2])$/.test(e.key)) return e.key;
  return null;
}

/** Uses e.code (physical key) for letters/digits so Alt/Option combos and non-QWERTY layouts still match. */
export function matchesHotkey(e: HotkeyEventLike, hotkey: ParsedHotkey): boolean {
  return e.ctrlKey === hotkey.ctrl && e.altKey === hotkey.alt && e.shiftKey === hotkey.shift
    && e.metaKey === hotkey.meta && eventKey(e) === hotkey.key;
}

/** For the admin "press the keys" box: the hotkey string a key press represents, or null if it isn't a valid combination. */
export function hotkeyFromEvent(e: HotkeyEventLike): string | null {
  const key = eventKey(e);
  if (!key) return null;
  return normalizeHotkey([e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift', e.metaKey && 'Meta', key].filter(Boolean).join('+'));
}
