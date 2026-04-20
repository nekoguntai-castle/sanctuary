import { Plus } from 'lucide-react';
import type { Device, DeviceAccount } from '../../../types';
import { AddAccountFlow } from '../accounts/AddAccountFlow';
import { getAccountTypeInfo } from '../accountTypes';

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
  if (!device.accounts || device.accounts.length === 0) {
    return <LegacyDeviceAccountCard device={device} />;
  }

  return (
    <div className="space-y-3">
      {device.accounts.map(account => (
        <DeviceAccountCard key={account.id} account={account} />
      ))}
    </div>
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
  const isMultisig = purpose === 'multisig';
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
