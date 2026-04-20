import type React from 'react';
import { Shield } from 'lucide-react';
import type { DeviceDetailTab } from './types';

type DeviceDetailTabsProps = {
  activeTab: DeviceDetailTab;
  onTabChange: (tab: DeviceDetailTab) => void;
};

export function DeviceDetailTabs({ activeTab, onTabChange }: DeviceDetailTabsProps) {
  return (
    <div className="border-b border-sanctuary-200 dark:border-sanctuary-800">
      <nav className="flex space-x-8">
        <DeviceTabButton
          active={activeTab === 'details'}
          tab="details"
          label="Details"
          onTabChange={onTabChange}
        />
        <DeviceTabButton
          active={activeTab === 'access'}
          tab="access"
          label="Access"
          icon={<Shield className="w-4 h-4" />}
          onTabChange={onTabChange}
        />
      </nav>
    </div>
  );
}

function DeviceTabButton({
  active,
  tab,
  label,
  icon,
  onTabChange,
}: {
  active: boolean;
  tab: DeviceDetailTab;
  label: string;
  icon?: React.ReactNode;
  onTabChange: (tab: DeviceDetailTab) => void;
}) {
  const className = active
    ? 'border-primary-500 text-primary-600 dark:text-primary-400'
    : 'border-transparent text-sanctuary-500 hover:text-sanctuary-700 dark:hover:text-sanctuary-300 hover:border-sanctuary-300 dark:hover:border-sanctuary-600';

  return (
    <button
      onClick={() => onTabChange(tab)}
      className={`py-3 px-1 border-b-2 font-medium text-sm transition-colors ${icon ? 'flex items-center gap-2' : ''} ${className}`}
    >
      {icon}
      {label}
    </button>
  );
}
