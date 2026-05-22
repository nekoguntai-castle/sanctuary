/**
 * SettingsSubTabs - Tab bar for switching between settings sections
 */

import React from 'react';
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

export const SettingsSubTabs: React.FC<SettingsSubTabsProps> = ({
  settingsSubTab,
  onSettingsSubTabChange,
}) => (
  <div className="flex gap-1 p-1 bg-sanctuary-100 dark:bg-sanctuary-800 rounded-lg w-fit">
    {TAB_ITEMS.map(({ key, label }) => (
      <button
        key={key}
        onClick={() => onSettingsSubTabChange(key)}
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
