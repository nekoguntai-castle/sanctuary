import type React from 'react';
import { ArrowDownLeft, ArrowUpRight, Plus } from 'lucide-react';
import { Button } from '../../../ui/Button';
import { useTabsA11y } from '../../../ui/useTabsA11y';
import type { AddressSubTab } from '../../types';

type AddressSubTabsProps = {
  addressSubTab: AddressSubTab;
  receiveCount: number;
  changeCount: number;
  loadingAddresses: boolean;
  onAddressSubTabChange: (tab: AddressSubTab) => void;
  onGenerateMoreAddresses: () => void;
};

const ADDRESS_SUB_TABS: AddressSubTab[] = ['receive', 'change'];
type AddressTabButtonProps = ReturnType<
  ReturnType<typeof useTabsA11y<AddressSubTab>>['getTabProps']
>;

export function AddressSubTabs({
  addressSubTab,
  receiveCount,
  changeCount,
  loadingAddresses,
  onAddressSubTabChange,
  onGenerateMoreAddresses,
}: AddressSubTabsProps) {
  const { getTabListProps, getTabProps } = useTabsA11y({
    tabs: ADDRESS_SUB_TABS,
    activeTab: addressSubTab,
    onTabChange: onAddressSubTabChange,
  });

  return (
    <div className="px-3 sm:px-6 py-3 surface-muted border-b border-sanctuary-100 dark:border-sanctuary-800">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div {...getTabListProps('Address type')} className="flex gap-1 p-1 max-w-full overflow-x-auto">
          <AddressSubTabButton
            active={addressSubTab === 'receive'}
            label="Receive"
            count={receiveCount}
            icon={<ArrowDownLeft className="w-4 h-4" />}
            tabProps={getTabProps('receive')}
          />
          <AddressSubTabButton
            active={addressSubTab === 'change'}
            label="Change"
            count={changeCount}
            icon={<ArrowUpRight className="w-4 h-4" />}
            tabProps={getTabProps('change')}
          />
        </div>
        <Button variant="ghost" size="sm" onClick={onGenerateMoreAddresses} isLoading={loadingAddresses}>
          <Plus className="w-4 h-4 mr-1" />
          Generate
        </Button>
      </div>
    </div>
  );
}

function AddressSubTabButton({
  active,
  label,
  count,
  icon,
  tabProps,
}: {
  active: boolean;
  label: string;
  count: number;
  icon: React.ReactNode;
  tabProps: AddressTabButtonProps;
}) {
  return (
    <button
      {...tabProps}
      className={`flex shrink-0 items-center gap-1 sm:gap-2 px-2 sm:px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
        active
          ? 'bg-white dark:bg-sanctuary-800 text-primary-700 dark:text-primary-700 shadow-sm'
          : 'text-sanctuary-500 hover:text-sanctuary-700 dark:hover:text-sanctuary-300'
      }`}
    >
      {icon}
      <span>{label}</span>
      <span className={`text-xs px-1.5 py-0.5 rounded-full ${
        active
          ? 'bg-primary-100 dark:bg-primary-100 text-primary-700 dark:text-primary-700'
          : 'bg-sanctuary-200 dark:bg-sanctuary-700 text-sanctuary-600 dark:text-sanctuary-300'
      }`}>
        {count}
      </span>
    </button>
  );
}
