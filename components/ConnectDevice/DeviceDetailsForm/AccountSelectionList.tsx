import type { DeviceAccount } from '../../../services/deviceParsers';
import { getPurposeLabel, getScriptLabel } from '../types';

interface AccountSelectionListProps {
  parsedAccounts: DeviceAccount[];
  selectedAccounts: Set<number>;
  onToggleAccount: (index: number) => void;
}

export function AccountSelectionList({
  parsedAccounts,
  selectedAccounts,
  onToggleAccount,
}: AccountSelectionListProps) {
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <label className="block text-xs font-medium text-sanctuary-500">Accounts to Import</label>
        <span className="text-[10px] text-sanctuary-400">
          {selectedAccounts.size} of {parsedAccounts.length} selected
        </span>
      </div>
      <div className="space-y-2 max-h-64 overflow-y-auto">
        {parsedAccounts.map((account, index) => (
          <AccountSelectionCard
            key={index}
            account={account}
            index={index}
            isSelected={selectedAccounts.has(index)}
            onToggleAccount={onToggleAccount}
          />
        ))}
      </div>
      <p className="text-[10px] text-sanctuary-400 mt-2">
        All accounts will be registered with this device for use in wallets.
      </p>
    </div>
  );
}

interface AccountSelectionCardProps {
  account: DeviceAccount;
  index: number;
  isSelected: boolean;
  onToggleAccount: (index: number) => void;
}

function AccountSelectionCard({
  account,
  index,
  isSelected,
  onToggleAccount,
}: AccountSelectionCardProps) {
  const purposeLabel = getPurposeLabel(account.purpose);
  const scriptLabel = getScriptLabel(account.scriptType);

  return (
    <label
      className={`block p-3 rounded-lg border cursor-pointer transition-all ${
        isSelected
          ? 'border-sanctuary-500 bg-sanctuary-100 dark:bg-sanctuary-800'
          : 'border-sanctuary-200 dark:border-sanctuary-700 bg-white dark:bg-sanctuary-900 hover:border-sanctuary-300 dark:hover:border-sanctuary-600'
      }`}
    >
      <div className="flex items-start gap-2">
        <input
          type="checkbox"
          checked={isSelected}
          onChange={() => onToggleAccount(index)}
          className="mt-1 rounded border-sanctuary-300 text-sanctuary-600 focus:ring-sanctuary-500"
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <PurposeBadge purpose={account.purpose} label={purposeLabel} />
            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-sanctuary-100 text-sanctuary-600 dark:bg-sanctuary-800 dark:text-sanctuary-400">
              {scriptLabel}
            </span>
          </div>
          <div className="text-xs font-mono text-sanctuary-600 dark:text-sanctuary-300 truncate">
            {account.derivationPath}
          </div>
          <div className="text-[10px] font-mono text-sanctuary-400 truncate mt-0.5" title={account.xpub}>
            {account.xpub.substring(0, 20)}...{account.xpub.substring(account.xpub.length - 8)}
          </div>
        </div>
      </div>
    </label>
  );
}

function PurposeBadge({ purpose, label }: { purpose: DeviceAccount['purpose']; label: string }) {
  return (
    <span
      className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${
        purpose === 'multisig'
          ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400'
          : 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
      }`}
    >
      {label}
    </span>
  );
}
