import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getAppShortcut,
  getShortcutDisplayLabel,
  isEditableShortcutTarget,
  matchesShortcutEvent,
  type AppShortcutDefinition,
} from '../../../src/app/shortcuts';

const consoleShortcut = getAppShortcut('console.open');
const shortcutsShortcut = getAppShortcut('shortcuts.open');

describe('app shortcuts', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('formats platform-specific shortcut labels', () => {
    expect(consoleShortcut.label).toBe('Open AI Console');
    expect(shortcutsShortcut.label).toBe('Show keyboard shortcuts');
    expect(getShortcutDisplayLabel(consoleShortcut, 'MacIntel')).toBe('⌘⇧.');
    expect(getShortcutDisplayLabel(consoleShortcut, 'Linux x86_64')).toBe(
      'Ctrl+Shift+.'
    );
    expect(getShortcutDisplayLabel(consoleShortcut)).toContain('.');
    expect(getShortcutDisplayLabel(shortcutsShortcut, 'Linux x86_64')).toBe(
      'Ctrl+/'
    );

    const expandedShortcut: AppShortcutDefinition = {
      id: 'console.open',
      label: 'Expanded',
      code: 'KeyK',
      key: 'k',
      modifiers: { ctrl: true, alt: true, meta: true },
    };

    expect(getShortcutDisplayLabel(expandedShortcut, 'MacIntel')).toBe('⌃⌥⌘K');
    expect(getShortcutDisplayLabel(expandedShortcut, 'Linux x86_64')).toBe(
      'Ctrl+Alt+Meta+K'
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
    expect(
      matchesShortcutEvent(
        new KeyboardEvent('keydown', {
          code: 'Comma',
          key: ',',
          ctrlKey: true,
          shiftKey: true,
        }),
        consoleShortcut,
        'Win32'
      )
    ).toBe(false);
    expect(
      matchesShortcutEvent(
        new KeyboardEvent('keydown', {
          code: 'Period',
          key: '.',
          ctrlKey: true,
          shiftKey: false,
        }),
        consoleShortcut,
        'Win32'
      )
    ).toBe(false);
    expect(
      matchesShortcutEvent(
        new KeyboardEvent('keydown', {
          code: 'Period',
          key: '.',
          ctrlKey: true,
          shiftKey: true,
          altKey: true,
        }),
        consoleShortcut,
        'Win32'
      )
    ).toBe(false);

    const strictShortcut: AppShortcutDefinition = {
      id: 'console.open',
      label: 'Strict',
      code: 'KeyK',
      key: 'k',
      modifiers: { ctrl: true, meta: true },
    };
    expect(
      matchesShortcutEvent(
        new KeyboardEvent('keydown', {
          code: 'KeyK',
          key: 'k',
          ctrlKey: true,
          metaKey: true,
        }),
        strictShortcut,
        'Win32'
      )
    ).toBe(true);
    expect(
      matchesShortcutEvent(
        new KeyboardEvent('keydown', {
          code: 'KeyK',
          key: 'k',
          metaKey: true,
        }),
        strictShortcut,
        'Win32'
      )
    ).toBe(false);
    expect(
      matchesShortcutEvent(
        new KeyboardEvent('keydown', {
          code: 'KeyK',
          key: 'k',
          ctrlKey: true,
        }),
        strictShortcut,
        'Win32'
      )
    ).toBe(false);
  });

  it('excludes editable shortcut targets', () => {
    const input = document.createElement('input');
    const textarea = document.createElement('textarea');
    const select = document.createElement('select');
    const editable = document.createElement('div');
    const editorScoped = document.createElement('div');
    const code = document.createElement('code');
    const button = document.createElement('button');
    Object.defineProperty(editable, 'isContentEditable', {
      configurable: true,
      value: true,
    });
    editorScoped.dataset.shortcutScope = 'editor';

    document.body.append(
      input,
      textarea,
      select,
      editable,
      editorScoped,
      code,
      button
    );

    expect(isEditableShortcutTarget(null)).toBe(false);
    expect(isEditableShortcutTarget(input)).toBe(true);
    expect(isEditableShortcutTarget(textarea)).toBe(true);
    expect(isEditableShortcutTarget(select)).toBe(true);
    expect(isEditableShortcutTarget(editable)).toBe(true);
    expect(isEditableShortcutTarget(editorScoped)).toBe(true);
    expect(isEditableShortcutTarget(code)).toBe(true);
    expect(isEditableShortcutTarget(button)).toBe(false);
  });

  it('throws for unknown shortcut ids', () => {
    expect(() => getAppShortcut('missing' as never)).toThrow(
      'Unknown shortcut: missing'
    );
  });

  it('handles environments without navigator metadata', () => {
    vi.stubGlobal('navigator', undefined);

    expect(getShortcutDisplayLabel(consoleShortcut)).toBe('Ctrl+Shift+.');
  });

  it('treats shortcut targets as non-editable without HTMLElement support', () => {
    const button = document.createElement('button');
    vi.stubGlobal('HTMLElement', undefined);

    expect(isEditableShortcutTarget(button)).toBe(false);
  });
});
