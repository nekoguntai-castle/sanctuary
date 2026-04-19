import React from 'react';
import type { AccessSubTab } from '../../types';
import { ACCESS_SUB_TABS } from './accessTabData';

interface AccessSubTabsProps {
  activeTab: AccessSubTab;
  onChange: (tab: AccessSubTab) => void;
}

export const AccessSubTabs: React.FC<AccessSubTabsProps> = ({
  activeTab,
  onChange,
}) => (
  <div className="flex space-x-1 p-1 surface-secondary rounded-lg w-fit">
    {ACCESS_SUB_TABS.map((tab) => (
      <button
        key={tab}
        onClick={() => onChange(tab)}
        className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors capitalize ${
          activeTab === tab
            ? 'bg-white dark:bg-sanctuary-700 text-sanctuary-900 dark:text-sanctuary-100 shadow-sm'
            : 'text-sanctuary-500 hover:text-sanctuary-700 dark:hover:text-sanctuary-300'
        }`}
      >
        {tab}
      </button>
    ))}
  </div>
);
