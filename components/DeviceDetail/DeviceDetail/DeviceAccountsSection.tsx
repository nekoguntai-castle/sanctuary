import { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { DeviceAccountPurpose as DeviceAccountPurposeValue } from '@sanctuary/shared/constants/walletIdentity';
import type { Device, DeviceAccount } from '../../../types';
import { useActiveNetwork } from '../../../contexts/ActiveNetworkContext';
import { AddAccountFlow } from '../accounts/AddAccountFlow';
import { getAccountTypeInfo } from '../accountTypes';
import {
  groupAccountsByNetwork,
  groupAccountsByPurpose,
  networkGroupMatchesNetwork,
  type DerivationNetworkGroup,
  type DeviceAccountPurpose,
} from '../../../utils/derivationPathGroups';

type DeviceAccountsSectionProps = {
  deviceId: string;
  device: Device;
  isOwner: boolean;
  showAddAccount: boolean;
  onShowAddAccount: () => void;
  onCloseAddAccount: () => void;
  onDeviceUpdated: (device: Device) => void;
};

export function DeviceAccountsSection({
  deviceId,
  device,
  isOwner,
  showAddAccount,
  onShowAddAccount,
  onCloseAddAccount,
  onDeviceUpdated,
}: DeviceAccountsSectionProps) {
  const accountCount = device.accounts?.length || 1;

  return (
    <div className="mt-6 pt-6 border-t border-sanctuary-100 dark:border-sanctuary-800">
      <DeviceAccountsHeader accountCount={accountCount} />
      <DeviceAccountsList device={device} />
      {isOwner && <AddAccountButton onShowAddAccount={onShowAddAccount} />}
      {showAddAccount && (
        <AddAccountFlow
          deviceId={deviceId}
          device={device}
          onClose={onCloseAddAccount}
          onDeviceUpdated={onDeviceUpdated}
        />
      )}
    </div>
  );
}

function DeviceAccountsHeader({ accountCount }: { accountCount: number }) {
  return (
    <div className="flex items-center justify-between mb-3">
      <p className="text-xs text-sanctuary-500 uppercase">Registered Accounts</p>
      <span className="text-xs text-sanctuary-400">
        {accountCount} {accountCount === 1 ? 'account' : 'accounts'}
      </span>
    </div>
  );
}

function DeviceAccountsList({ device }: { device: Device }) {
  const { selectedNetwork } = useActiveNetwork();

  if (!device.accounts || device.accounts.length === 0) {
    return <LegacyDeviceAccountCard device={device} />;
  }

  const accountsByNetwork = groupAccountsByNetwork(device.accounts);
  const initialNetworkTab = networkGroupMatchesNetwork('testnet-signet', selectedNetwork) &&
    accountsByNetwork['testnet-signet'].length > 0
      ? 'testnet-signet'
      : 'mainnet';

  return (
    <DeviceAccountTabs
      accountsByNetwork={accountsByNetwork}
      initialNetworkTab={initialNetworkTab}
    />
  );
}

function DeviceAccountTabs({
  accountsByNetwork,
  initialNetworkTab,
}: {
  accountsByNetwork: Record<DerivationNetworkGroup, DeviceAccount[]>;
  initialNetworkTab: DerivationNetworkGroup;
}) {
  const [networkTab, setNetworkTab] = useState<DerivationNetworkGroup>(initialNetworkTab);
  const [purposeTab, setPurposeTab] = useState<DeviceAccountPurpose>(
    DeviceAccountPurposeValue.SINGLE_SIG,
  );
  const availableNetworkTabs = (['mainnet', 'testnet-signet'] as const).filter(
    tab => accountsByNetwork[tab].length > 0
  );
  /* v8 ignore next -- defensive guard; parent renders legacy card before empty account groups reach tabs. */
  if (availableNetworkTabs.length === 0) return null;

  const activeNetworkTab: DerivationNetworkGroup = accountsByNetwork[networkTab].length > 0
    ? networkTab
    : availableNetworkTabs[0];
  const accountsByPurpose = groupAccountsByPurpose(accountsByNetwork[activeNetworkTab]);
  const activePurposeTab: DeviceAccountPurpose = accountsByPurpose[purposeTab].length > 0
    ? purposeTab
    : accountsByPurpose[DeviceAccountPurposeValue.MULTISIG].length > 0
    ? DeviceAccountPurposeValue.MULTISIG
    : DeviceAccountPurposeValue.SINGLE_SIG;
  const activeAccounts = accountsByPurpose[activePurposeTab];

  useEffect(() => {
    setNetworkTab(initialNetworkTab);
  }, [initialNetworkTab]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {availableNetworkTabs.map(tab => (
          <NetworkAccountTabButton
            key={tab}
            tab={tab}
            active={tab === activeNetworkTab}
            count={accountsByNetwork[tab].length}
            onClick={() => setNetworkTab(tab)}
          />
        ))}
      </div>
      <div className="flex items-center gap-2">
        <PurposeAccountTabButton
          purpose={DeviceAccountPurposeValue.SINGLE_SIG}
          active={activePurposeTab === DeviceAccountPurposeValue.SINGLE_SIG}
          count={accountsByPurpose[DeviceAccountPurposeValue.SINGLE_SIG].length}
          onClick={() => setPurposeTab(DeviceAccountPurposeValue.SINGLE_SIG)}
        />
        <PurposeAccountTabButton
          purpose={DeviceAccountPurposeValue.MULTISIG}
          active={activePurposeTab === DeviceAccountPurposeValue.MULTISIG}
          count={accountsByPurpose[DeviceAccountPurposeValue.MULTISIG].length}
          onClick={() => setPurposeTab(DeviceAccountPurposeValue.MULTISIG)}
        />
      </div>
      <div className="space-y-3">
        {activeAccounts.map(account => (
          <DeviceAccountCard key={account.id} account={account} />
        ))}
      </div>
    </div>
  );
}

function NetworkAccountTabButton({
  tab,
  active,
  count,
  onClick,
}: {
  tab: DerivationNetworkGroup;
  active: boolean;
  count: number;
  onClick: () => void;
}) {
  const isMainnet = tab === 'mainnet';
  const label = isMainnet ? 'Mainnet' : 'Testnet-family / Signet';
  const activeClass = isMainnet
    ? 'bg-mainnet-100/50 dark:bg-mainnet-900/20 text-mainnet-700 dark:text-mainnet-300 border-mainnet-200 dark:border-mainnet-700'
    : 'bg-testnet-100/50 dark:bg-testnet-900/20 text-testnet-700 dark:text-testnet-300 border-testnet-200 dark:border-testnet-700';

  return (
    <button
      type="button"
      className={`px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
        active
          ? activeClass
          : 'border-sanctuary-200 dark:border-sanctuary-800 text-sanctuary-600 dark:text-sanctuary-400 hover:border-sanctuary-400'
      }`}
      onClick={onClick}
    >
      {label} <span className="text-[10px] opacity-70">({count})</span>
    </button>
  );
}

function PurposeAccountTabButton({
  purpose,
  active,
  count,
  onClick,
}: {
  purpose: DeviceAccountPurpose;
  active: boolean;
  count: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
        active
          ? 'surface-secondary text-sanctuary-900 dark:text-sanctuary-100 border-sanctuary-300 dark:border-sanctuary-700'
          : 'border-sanctuary-200 dark:border-sanctuary-800 text-sanctuary-600 dark:text-sanctuary-400 hover:border-sanctuary-400'
      }`}
      onClick={onClick}
    >
      {purpose === DeviceAccountPurposeValue.MULTISIG ? 'Multisig' : 'Single-sig'} <span className="text-[10px] opacity-70">({count})</span>
    </button>
  );
}

function DeviceAccountCard({ account }: { account: DeviceAccount }) {
  const info = getAccountTypeInfo(account);

  return (
    <div className="surface-muted p-4 rounded-lg border border-sanctuary-200 dark:border-sanctuary-800">
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sanctuary-900 dark:text-sanctuary-100 text-sm">
            {info.title}
          </span>
          {info.recommended && <RecommendedBadge />}
        </div>
        <AccountKindBadge purpose={account.purpose} />
      </div>
      <p className="text-xs text-sanctuary-500 mb-3">
        {info.description} <span className="text-sanctuary-400">Addresses: {info.addressPrefix}</span>
      </p>
      <AccountKeyDetails derivationPath={account.derivationPath} xpub={account.xpub} />
    </div>
  );
}

function RecommendedBadge() {
  return (
    <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 font-medium">
      Recommended
    </span>
  );
}

function AccountKindBadge({ purpose }: { purpose: DeviceAccount['purpose'] }) {
  const isMultisig = purpose === DeviceAccountPurposeValue.MULTISIG;
  const className = isMultisig
    ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400'
    : 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400';

  return (
    <span className={`text-[10px] px-2 py-0.5 rounded font-medium ${className}`}>
      {isMultisig ? 'Multisig' : 'Single-sig'}
    </span>
  );
}

function AccountKeyDetails({ derivationPath, xpub }: { derivationPath: string; xpub: string }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
      <div>
        <p className="text-[10px] text-sanctuary-400 uppercase mb-1">Derivation Path</p>
        <code className="text-xs text-sanctuary-600 dark:text-sanctuary-300 font-mono">
          {derivationPath}
        </code>
      </div>
      <div className="md:col-span-2">
        <p className="text-[10px] text-sanctuary-400 uppercase mb-1">Extended Public Key</p>
        <code className="text-[10px] text-sanctuary-600 dark:text-sanctuary-400 break-all font-mono block">
          {xpub}
        </code>
      </div>
    </div>
  );
}

function LegacyDeviceAccountCard({ device }: { device: Device }) {
  return (
    <div className="surface-muted p-4 rounded-lg border border-sanctuary-200 dark:border-sanctuary-800">
      <AccountKeyDetails
        derivationPath={device.derivationPath || "m/84'/0'/0'"}
        xpub={device.xpub || 'N/A'}
      />
    </div>
  );
}

function AddAccountButton({ onShowAddAccount }: { onShowAddAccount: () => void }) {
  return (
    <button
      onClick={onShowAddAccount}
      className="mt-4 flex items-center justify-center gap-2 w-full px-4 py-2.5 rounded-lg border border-dashed border-sanctuary-300 dark:border-sanctuary-700 text-sanctuary-500 hover:text-sanctuary-700 dark:hover:text-sanctuary-300 hover:border-sanctuary-400 dark:hover:border-sanctuary-600 transition-colors"
    >
      <Plus className="w-4 h-4" />
      <span className="text-sm font-medium">Add Derivation Path</span>
    </button>
  );
}
