import type React from 'react';
import { Shield } from 'lucide-react';
import { useTabsA11y } from '../../ui/useTabsA11y';
import type { DeviceDetailTab } from './types';

type DeviceDetailTabsProps = {
  activeTab: DeviceDetailTab;
  onTabChange: (tab: DeviceDetailTab) => void;
};

const DEVICE_DETAIL_TABS: DeviceDetailTab[] = ['details', 'access'];
type DeviceDetailTabButtonProps = ReturnType<
  ReturnType<typeof useTabsA11y<DeviceDetailTab>>['getTabProps']
>;

export function DeviceDetailTabs({ activeTab, onTabChange }: DeviceDetailTabsProps) {
  const { getTabListProps, getTabProps } = useTabsA11y({
    tabs: DEVICE_DETAIL_TABS,
    activeTab,
    onTabChange,
  });

  return (
    <div className="border-b border-sanctuary-200 dark:border-sanctuary-800">
      <nav {...getTabListProps('Device detail sections')} className="flex space-x-8">
        <DeviceTabButton
          active={activeTab === 'details'}
          label="Details"
          tabProps={getTabProps('details')}
        />
        <DeviceTabButton
          active={activeTab === 'access'}
          label="Access"
          icon={<Shield className="w-4 h-4" />}
          tabProps={getTabProps('access')}
        />
      </nav>
    </div>
  );
}

function DeviceTabButton({
  active,
  label,
  icon,
  tabProps,
}: {
  active: boolean;
  label: string;
  icon?: React.ReactNode;
  tabProps: DeviceDetailTabButtonProps;
}) {
  const className = active
    ? 'border-primary-500 text-primary-600 dark:text-primary-400'
    : 'border-transparent text-sanctuary-500 hover:text-sanctuary-700 dark:hover:text-sanctuary-300 hover:border-sanctuary-300 dark:hover:border-sanctuary-600';

  return (
    <button
      {...tabProps}
      className={`py-3 px-1 border-b-2 font-medium text-sm transition-colors ${icon ? 'flex items-center gap-2' : ''} ${className}`}
    >
      {icon}
      {label}
    </button>
  );
}
