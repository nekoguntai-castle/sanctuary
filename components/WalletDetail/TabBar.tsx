import React, { useRef, useState, useEffect, useCallback, useMemo } from 'react';
import { useTabsA11y } from '../ui/useTabsA11y';
import { getWalletDetailTabs } from './tabDefinitions';
import type { TabType } from './types';

interface TabBarProps {
  activeTab: TabType;
  onTabChange: (tab: TabType) => void;
  userRole: string;
  draftsCount: number;
}

export const TabBar: React.FC<TabBarProps> = ({
  activeTab,
  onTabChange,
  userRole,
  draftsCount,
}) => {
  const tabs = useMemo(() => getWalletDetailTabs(userRole), [userRole]);
  const tabIds = useMemo(() => tabs.map((tab) => tab.id), [tabs]);
  const { getTabListProps, getTabProps } = useTabsA11y({
    tabs: tabIds,
    activeTab,
    onTabChange,
  });

  const navRef = useRef<HTMLElement>(null);
  const [indicator, setIndicator] = useState({ left: 0, width: 0 });

  const updateIndicator = useCallback(() => {
    /* v8 ignore start -- defensive guard; ref is always attached after mount */
    if (!navRef.current) return;
    /* v8 ignore stop */
    const activeEl = navRef.current.querySelector('[data-active="true"]') as HTMLElement | null;
    if (activeEl) {
      setIndicator({
        left: activeEl.offsetLeft,
        width: activeEl.offsetWidth,
      });
    }
  }, []);

  useEffect(() => {
    updateIndicator();
  }, [activeTab, updateIndicator]);

  // Recalculate on resize
  useEffect(() => {
    window.addEventListener('resize', updateIndicator);
    return () => window.removeEventListener('resize', updateIndicator);
  }, [updateIndicator]);

  return (
    <div className="overflow-x-auto scrollbar-hide">
      <nav
        ref={navRef}
        {...getTabListProps('Wallet sections')}
        className="relative flex gap-1 p-1 surface-secondary rounded-lg"
      >
        {/* Sliding indicator */}
        <div
          className="absolute top-1 bottom-1 rounded-md bg-white dark:bg-sanctuary-600 shadow-sm transition-all duration-300 ease-out z-0"
          style={{ left: indicator.left, width: indicator.width }}
        />
        {tabs.map((tab) => (
          <button
            key={tab.id}
            {...getTabProps(tab.id)}
            className={`${
              activeTab === tab.id
                ? 'text-primary-700 dark:text-primary-700'
                : 'text-sanctuary-500 hover:text-sanctuary-700 dark:text-sanctuary-400 dark:hover:text-sanctuary-200'
            } whitespace-nowrap py-2 px-3.5 rounded-md font-medium text-sm capitalize transition-colors duration-200 relative z-10 focus-visible:ring-2 focus-visible:ring-primary-500`}
          >
            {tab.label}
            {tab.badge === 'drafts' && draftsCount > 0 && (
              <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-rose-400 dark:bg-rose-500 text-[10px] font-bold text-white z-20">
                {draftsCount > 9 ? '9+' : draftsCount}
              </span>
            )}
          </button>
        ))}
      </nav>
    </div>
  );
};
