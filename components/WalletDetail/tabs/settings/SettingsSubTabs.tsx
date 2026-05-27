/**
 * SettingsSubTabs - Tab bar for switching between settings sections
 */

import React from 'react';
import { useTabsA11y } from '../../../ui/useTabsA11y';
import type { SettingsSubTab } from '../../types';

interface SettingsSubTabsProps {
  settingsSubTab: SettingsSubTab;
  onSettingsSubTabChange: (tab: SettingsSubTab) => void;
}

const TAB_ITEMS: { key: SettingsSubTab; label: string }[] = [
  { key: 'general', label: 'General' },
  { key: 'devices', label: 'Devices' },
  { key: 'notifications', label: 'Notifications' },
  { key: 'webhooks', label: 'Webhooks' },
  { key: 'advanced', label: 'Advanced' },
  { key: 'autopilot', label: 'Autopilot' },
];
const TAB_KEYS = TAB_ITEMS.map((tab) => tab.key);

export const SettingsSubTabs: React.FC<SettingsSubTabsProps> = ({
  settingsSubTab,
  onSettingsSubTabChange,
}) => {
  const { getTabListProps, getTabProps } = useTabsA11y({
    tabs: TAB_KEYS,
    activeTab: settingsSubTab,
    onTabChange: onSettingsSubTabChange,
  });

  return (
    <div
      {...getTabListProps('Wallet settings sections')}
      className="flex gap-1 p-1 bg-sanctuary-100 dark:bg-sanctuary-800 rounded-lg w-fit"
    >
      {TAB_ITEMS.map(({ key, label }) => (
        <button
          key={key}
          {...getTabProps(key)}
          className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
            settingsSubTab === key
              ? 'bg-white dark:bg-sanctuary-700 text-sanctuary-900 dark:text-sanctuary-100 shadow-sm'
              : 'text-sanctuary-600 dark:text-sanctuary-400 hover:text-sanctuary-900 dark:hover:text-sanctuary-200'
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
};
