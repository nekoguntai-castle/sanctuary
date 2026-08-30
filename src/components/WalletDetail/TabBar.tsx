import React, { useMemo } from 'react';
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

  return (
    <div className="overflow-x-auto scrollbar-hide">
      <nav
        {...getTabListProps('Wallet sections')}
        className="relative flex gap-1 p-1 surface-secondary rounded-lg"
      >
        {tabs.map((tab) => (
          <button
            key={tab.id}
            {...getTabProps(tab.id)}
            className={`${
              activeTab === tab.id
                ? 'bg-white dark:bg-sanctuary-600 shadow-sm text-primary-700 dark:text-primary-700'
                : 'text-sanctuary-500 hover:text-sanctuary-700 dark:text-sanctuary-400 dark:hover:text-sanctuary-200'
            } whitespace-nowrap py-2 px-3.5 rounded-md font-medium text-sm capitalize transition-colors duration-200 relative focus-visible:ring-2 focus-visible:ring-primary-500`}
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
