import type React from 'react';
import { LogTab } from './LogTab';
import {
  TransactionsTab,
  UTXOTab,
  AddressesTab,
  DraftsTab,
  StatsTab,
  AccessTab,
  SettingsTab,
} from './tabs';
import type { TabType } from './types';

type TransactionsTabProps = React.ComponentProps<typeof TransactionsTab>;
type UTXOTabProps = React.ComponentProps<typeof UTXOTab>;
type AddressesTabProps = React.ComponentProps<typeof AddressesTab>;
type DraftsTabProps = React.ComponentProps<typeof DraftsTab>;
type StatsTabProps = React.ComponentProps<typeof StatsTab>;
type LogTabProps = React.ComponentProps<typeof LogTab>;
type AccessTabProps = React.ComponentProps<typeof AccessTab>;
type SettingsTabProps = React.ComponentProps<typeof SettingsTab>;

interface WalletDetailTabContentProps {
  visibleActiveTab: TabType;
  transactionsTabProps: TransactionsTabProps;
  utxoTabProps: UTXOTabProps;
  addressesTabProps: AddressesTabProps;
  draftsTabProps: DraftsTabProps;
  statsTabProps: StatsTabProps;
  logTabProps: LogTabProps;
  accessTabProps: AccessTabProps;
  settingsTabProps: SettingsTabProps;
}

export function WalletDetailTabContent(props: WalletDetailTabContentProps) {
  return (
    <div className="min-h-[400px]">
      {renderWalletDetailTab(props)}
    </div>
  );
}

function renderWalletDetailTab({
  visibleActiveTab,
  transactionsTabProps,
  utxoTabProps,
  addressesTabProps,
  draftsTabProps,
  statsTabProps,
  logTabProps,
  accessTabProps,
  settingsTabProps,
}: WalletDetailTabContentProps) {
  switch (visibleActiveTab) {
    case 'tx':
      return <TransactionsTab {...transactionsTabProps} />;
    case 'utxo':
      return <UTXOTab {...utxoTabProps} />;
    case 'addresses':
      return <AddressesTab {...addressesTabProps} />;
    case 'drafts':
      return <DraftsTab {...draftsTabProps} />;
    case 'stats':
      return <StatsTab {...statsTabProps} />;
    case 'log':
      return <LogTab {...logTabProps} />;
    case 'access':
      return <AccessTab {...accessTabProps} />;
    case 'settings':
      return <SettingsTab {...settingsTabProps} />;
    default:
      return null;
  }
}
