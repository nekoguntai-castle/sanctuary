import React from 'react';
import { TabType } from './types';

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
  const tabs: TabType[] = [
    'tx',
    'utxo',
    'addresses',
    ...(userRole !== 'viewer' ? ['drafts' as TabType] : []),
    'stats',
    ...(userRole === 'owner' ? ['access' as TabType] : []),
    'settings',
    'log',
  ];

  return (
    <div className="border-b border-sanctuary-200 dark:border-sanctuary-800 overflow-x-auto scrollbar-hide">
      <nav className="-mb-px flex space-x-8" aria-label="Tabs">
        {tabs.map((tab) => (
          <button
            key={tab}
            onClick={() => onTabChange(tab)}
            className={`${
              activeTab === tab
                ? 'border-primary-600 dark:border-primary-400 text-primary-700 dark:text-primary-300'
                : 'border-transparent text-sanctuary-500 hover:text-sanctuary-700 hover:border-sanctuary-300'
            } whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm capitalize transition-colors relative`}
          >
            {tab === 'tx' ? 'Transactions' : tab === 'utxo' ? 'UTXOs' : tab}
            {tab === 'drafts' && draftsCount > 0 && (
              <span className="absolute -top-0.5 -right-3 flex h-4 w-4 items-center justify-center rounded-full bg-rose-400 dark:bg-rose-500 text-[10px] font-bold text-white">
                {draftsCount > 9 ? '9+' : draftsCount}
              </span>
            )}
          </button>
        ))}
      </nav>
    </div>
  );
};
