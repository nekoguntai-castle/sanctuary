export type AppShortcutId = 'console.open' | 'shortcuts.open';

interface ShortcutModifiers {
  mod?: boolean;
  shift?: boolean;
  alt?: boolean;
  ctrl?: boolean;
  meta?: boolean;
}

export interface AppShortcutDefinition {
  id: AppShortcutId;
  label: string;
  code: string;
  key: string;
  modifiers: ShortcutModifiers;
}

export const appShortcuts: AppShortcutDefinition[] = [
  {
    id: 'console.open',
    label: 'Open AI Console',
    code: 'Period',
    key: '.',
    modifiers: { mod: true, shift: true },
  },
  {
    id: 'shortcuts.open',
    label: 'Show keyboard shortcuts',
    code: 'Slash',
    key: '/',
    modifiers: { mod: true },
  },
];

const getDefaultPlatform = () =>
  typeof navigator === 'undefined' ? '' : navigator.platform;

export function getAppShortcut(id: AppShortcutId): AppShortcutDefinition {
  const shortcut = appShortcuts.find((entry) => entry.id === id);
  if (!shortcut) throw new Error(`Unknown shortcut: ${id}`);
  return shortcut;
}

export function isApplePlatform(platform = getDefaultPlatform()): boolean {
  return /mac|iphone|ipad|ipod/i.test(platform);
}

export function getShortcutDisplayLabel(
  shortcut: AppShortcutDefinition,
  platform = getDefaultPlatform()
): string {
  const isApple = isApplePlatform(platform);
  const parts: string[] = [];

  if (shortcut.modifiers.mod) parts.push(isApple ? '⌘' : 'Ctrl');
  if (shortcut.modifiers.ctrl) parts.push(isApple ? '⌃' : 'Ctrl');
  if (shortcut.modifiers.alt) parts.push(isApple ? '⌥' : 'Alt');
  if (shortcut.modifiers.shift) parts.push(isApple ? '⇧' : 'Shift');
  if (shortcut.modifiers.meta) parts.push(isApple ? '⌘' : 'Meta');
  parts.push(shortcut.key.toUpperCase());

  return isApple ? parts.join('') : parts.join('+');
}

export function isEditableShortcutTarget(target: EventTarget | null): boolean {
  if (typeof HTMLElement === 'undefined') return false;
  if (!(target instanceof HTMLElement)) return false;

  const tagName = target.tagName.toLowerCase();
  if (tagName === 'input' || tagName === 'textarea' || tagName === 'select')
    return true;
  if (target.isContentEditable) return true;

  return !!target.closest(
    '[contenteditable="true"], [data-shortcut-scope="editor"], pre, code'
  );
}

export function matchesShortcutEvent(
  event: KeyboardEvent,
  shortcut: AppShortcutDefinition,
  platform = getDefaultPlatform()
): boolean {
  const expectedMod = shortcut.modifiers.mod;
  const modMatches =
    !expectedMod || (isApplePlatform(platform) ? event.metaKey : event.ctrlKey);
  const ctrlMatches = !shortcut.modifiers.ctrl || event.ctrlKey;
  const metaMatches = !shortcut.modifiers.meta || event.metaKey;
  const altMatches = Boolean(event.altKey) === Boolean(shortcut.modifiers.alt);
  const shiftMatches =
    Boolean(event.shiftKey) === Boolean(shortcut.modifiers.shift);
  const keyMatches =
    event.code === shortcut.code || event.key.toLowerCase() === shortcut.key;

  return (
    modMatches &&
    ctrlMatches &&
    metaMatches &&
    altMatches &&
    shiftMatches &&
    keyMatches
  );
}
