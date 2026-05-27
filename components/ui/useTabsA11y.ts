import { useCallback } from 'react';
import type React from 'react';

type TabValue = string;

interface UseTabsA11yOptions<T extends TabValue> {
  tabs: readonly T[];
  activeTab: T;
  onTabChange: (tab: T) => void;
  isTabDisabled?: (tab: T) => boolean;
}

interface TabButtonOptions {
  disabled?: boolean;
  id?: string;
  controls?: string;
}

const FORWARD_KEYS = new Set(['ArrowRight', 'ArrowDown']);
const BACKWARD_KEYS = new Set(['ArrowLeft', 'ArrowUp']);

function getEnabledTabs<T extends TabValue>(
  tabs: readonly T[],
  isTabDisabled?: (tab: T) => boolean
): T[] {
  return tabs.filter((tab) => !isTabDisabled?.(tab));
}

function getRelativeTab<T extends TabValue>(
  tabs: readonly T[],
  activeTab: T,
  direction: 1 | -1,
  isTabDisabled?: (tab: T) => boolean
): T | undefined {
  if (tabs.length === 0) return undefined;

  const activeIndex = tabs.indexOf(activeTab);
  let nextIndex = activeIndex >= 0 ? activeIndex : direction === 1 ? -1 : 0;

  for (let attempt = 0; attempt < tabs.length; attempt += 1) {
    nextIndex = (nextIndex + direction + tabs.length) % tabs.length;
    const candidate = tabs[nextIndex];
    if (!isTabDisabled?.(candidate)) return candidate;
  }

  return undefined;
}

function focusTabButton(container: HTMLElement, tab: TabValue) {
  const focusButton = () => {
    const buttons = Array.from(
      container.querySelectorAll<HTMLElement>('[role="tab"][data-tab-value]')
    );
    buttons.find((button) => button.dataset.tabValue === tab)?.focus();
  };

  if (
    typeof window !== 'undefined' &&
    typeof window.requestAnimationFrame === 'function'
  ) {
    window.requestAnimationFrame(focusButton);
    return;
  }

  focusButton();
}

export function useTabsA11y<T extends TabValue>({
  tabs,
  activeTab,
  onTabChange,
  isTabDisabled,
}: UseTabsA11yOptions<T>) {
  const handleKeyDown = useCallback<React.KeyboardEventHandler<HTMLElement>>(
    (event) => {
      const enabledTabs = getEnabledTabs(tabs, isTabDisabled);
      let nextTab: T | undefined;

      if (FORWARD_KEYS.has(event.key)) {
        nextTab = getRelativeTab(tabs, activeTab, 1, isTabDisabled);
      } else if (BACKWARD_KEYS.has(event.key)) {
        nextTab = getRelativeTab(tabs, activeTab, -1, isTabDisabled);
      } else if (event.key === 'Home') {
        nextTab = enabledTabs[0];
      } else if (event.key === 'End') {
        nextTab = enabledTabs[enabledTabs.length - 1];
      }

      if (!nextTab) return;

      event.preventDefault();
      onTabChange(nextTab);
      focusTabButton(event.currentTarget, nextTab);
    },
    [activeTab, isTabDisabled, onTabChange, tabs]
  );

  const getTabListProps = useCallback(
    (label: string) => ({
      role: 'tablist' as const,
      'aria-label': label,
      onKeyDown: handleKeyDown,
    }),
    [handleKeyDown]
  );

  const getTabProps = useCallback(
    (tab: T, options: TabButtonOptions = {}) => {
      const disabled = options.disabled ?? isTabDisabled?.(tab) ?? false;
      const selected = activeTab === tab;

      return {
        role: 'tab' as const,
        type: 'button' as const,
        'aria-selected': selected,
        'aria-disabled': disabled || undefined,
        'aria-controls': options.controls,
        id: options.id,
        tabIndex: selected ? 0 : -1,
        'data-active': selected,
        'data-tab-value': tab,
        onClick: () => {
          if (!disabled) onTabChange(tab);
        },
      };
    },
    [activeTab, isTabDisabled, onTabChange]
  );

  return { getTabListProps, getTabProps };
}
