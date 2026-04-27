import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  useAppShortcuts,
  type AppShortcutBinding,
} from '../../hooks/useAppShortcuts';

function dispatchConsoleShortcut(target: EventTarget = window): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    code: 'Period',
    key: '.',
    ctrlKey: true,
    shiftKey: true,
    bubbles: true,
    cancelable: true,
  });
  target.dispatchEvent(event);
  return event;
}

describe('useAppShortcuts', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('runs the first enabled matching binding and prevents the browser default', () => {
    const firstHandler = vi.fn();
    const secondHandler = vi.fn();
    const bindings: AppShortcutBinding[] = [
      { id: 'console.open', handler: firstHandler },
      { id: 'console.open', handler: secondHandler },
    ];

    renderHook(() => useAppShortcuts(bindings));

    const event = dispatchConsoleShortcut();

    expect(firstHandler).toHaveBeenCalledWith(event);
    expect(secondHandler).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(true);
  });

  it('ignores disabled, already-prevented, non-matching, and editable-target events', () => {
    const handler = vi.fn();
    const bindings: AppShortcutBinding[] = [
      { id: 'console.open', enabled: false, handler },
    ];
    renderHook(() => useAppShortcuts(bindings));

    dispatchConsoleShortcut();
    expect(handler).not.toHaveBeenCalled();

    const preventedEvent = new KeyboardEvent('keydown', {
      code: 'Period',
      key: '.',
      ctrlKey: true,
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    preventedEvent.preventDefault();
    window.dispatchEvent(preventedEvent);
    expect(handler).not.toHaveBeenCalled();

    const wrongKeyEvent = new KeyboardEvent('keydown', {
      code: 'Comma',
      key: ',',
      ctrlKey: true,
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(wrongKeyEvent);
    expect(handler).not.toHaveBeenCalled();

    const input = document.createElement('input');
    document.body.appendChild(input);
    dispatchConsoleShortcut(input);
    input.remove();
    expect(handler).not.toHaveBeenCalled();
  });

  it('falls through when an enabled binding does not match the key event', () => {
    const handler = vi.fn();
    const bindings: AppShortcutBinding[] = [
      { id: 'console.open', handler },
    ];
    renderHook(() => useAppShortcuts(bindings));

    const event = new KeyboardEvent('keydown', {
      code: 'Comma',
      key: ',',
      ctrlKey: true,
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(event);

    expect(handler).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it('updates bindings on rerender and removes the listener on unmount', () => {
    const firstHandler = vi.fn();
    const secondHandler = vi.fn();
    const { rerender, unmount } = renderHook(
      ({ bindings }) => useAppShortcuts(bindings),
      {
        initialProps: {
          bindings: [
            { id: 'console.open', handler: firstHandler },
          ] satisfies AppShortcutBinding[],
        },
      }
    );

    dispatchConsoleShortcut();
    expect(firstHandler).toHaveBeenCalledTimes(1);

    rerender({
      bindings: [
        { id: 'console.open', handler: secondHandler },
      ] satisfies AppShortcutBinding[],
    });
    dispatchConsoleShortcut();
    expect(firstHandler).toHaveBeenCalledTimes(1);
    expect(secondHandler).toHaveBeenCalledTimes(1);

    unmount();
    dispatchConsoleShortcut();
    expect(secondHandler).toHaveBeenCalledTimes(1);
  });
});
