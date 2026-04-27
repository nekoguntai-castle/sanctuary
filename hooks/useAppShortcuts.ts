import { useEffect } from 'react';
import {
  getAppShortcut,
  isEditableShortcutTarget,
  matchesShortcutEvent,
  type AppShortcutId,
} from '../src/app/shortcuts';

export interface AppShortcutBinding {
  id: AppShortcutId;
  enabled?: boolean;
  handler: (event: KeyboardEvent) => void;
}

export function useAppShortcuts(bindings: AppShortcutBinding[]): void {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || isEditableShortcutTarget(event.target))
        return;

      for (const binding of bindings) {
        if (binding.enabled === false) continue;

        const shortcut = getAppShortcut(binding.id);
        if (matchesShortcutEvent(event, shortcut)) {
          event.preventDefault();
          binding.handler(event);
          return;
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [bindings]);
}
