import { describe, expect, it } from 'vitest';
import {
  getAppShortcut,
  getShortcutDisplayLabel,
  isEditableShortcutTarget,
  matchesShortcutEvent,
} from '../../../src/app/shortcuts';

const consoleShortcut = getAppShortcut('console.open');

describe('app shortcuts', () => {
  it('formats platform-specific shortcut labels', () => {
    expect(getShortcutDisplayLabel(consoleShortcut, 'MacIntel')).toBe('⌘⇧.');
    expect(getShortcutDisplayLabel(consoleShortcut, 'Linux x86_64')).toBe(
      'Ctrl+Shift+.'
    );
  });

  it('matches the Console shortcut by keyboard code and platform modifier', () => {
    const event = new KeyboardEvent('keydown', {
      code: 'Period',
      key: '>',
      ctrlKey: true,
      shiftKey: true,
    });

    expect(matchesShortcutEvent(event, consoleShortcut, 'Win32')).toBe(true);
    expect(matchesShortcutEvent(event, consoleShortcut, 'MacIntel')).toBe(
      false
    );
  });

  it('excludes editable shortcut targets', () => {
    const input = document.createElement('input');
    const code = document.createElement('code');
    const button = document.createElement('button');

    document.body.append(input, code, button);

    expect(isEditableShortcutTarget(input)).toBe(true);
    expect(isEditableShortcutTarget(code)).toBe(true);
    expect(isEditableShortcutTarget(button)).toBe(false);
  });
});
