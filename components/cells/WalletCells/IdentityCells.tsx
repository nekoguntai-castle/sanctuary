import { Users } from 'lucide-react';
import { WalletType } from '../../../types';
import { getWalletIcon } from '../../ui/CustomIcons';
import type { WalletCellProps, WalletWithPending } from './types';

function getWalletIconDisplay(wallet: WalletWithPending) {
  const isMultisig = wallet.type === 'multi_sig';

  return {
    iconClass: isMultisig
      ? 'text-warning-600 dark:text-warning-400'
      : 'text-success-600 dark:text-success-400',
    walletTypeForIcon: isMultisig ? WalletType.MULTI_SIG : WalletType.SINGLE_SIG,
  };
}

function getWalletTypeBadgeClass(isMultisig: boolean) {
  return isMultisig
    ? 'bg-warning-100 text-warning-800 border border-warning-200 dark:bg-warning-500/10 dark:text-warning-300 dark:border-warning-500/20'
    : 'bg-success-100 text-success-800 border border-success-200 dark:bg-success-500/10 dark:text-success-300 dark:border-success-500/20';
}

export function NameCell({ item: wallet }: WalletCellProps) {
  const { iconClass, walletTypeForIcon } = getWalletIconDisplay(wallet);

  return (
    <div className="flex items-center">
      <div className="flex-shrink-0 h-8 w-8 rounded-full surface-secondary flex items-center justify-center">
        {getWalletIcon(walletTypeForIcon, `w-4 h-4 ${iconClass}`)}
      </div>
      <div className="ml-4">
        <div className="text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100">
          {wallet.name}
        </div>
        <div className="text-xs text-sanctuary-500 capitalize">
          {(wallet.scriptType ?? 'unknown').replace('_', ' ')}
        </div>
      </div>
    </div>
  );
}

export function TypeCell({ item: wallet }: WalletCellProps) {
  const isMultisig = wallet.type === 'multi_sig';

  return (
    <div className="flex items-center gap-2">
      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getWalletTypeBadgeClass(isMultisig)}`}>
        {isMultisig ? `${wallet.quorum} of ${wallet.totalSigners}` : 'Single Sig'}
      </span>
      {wallet.isShared && (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-shared-100 text-shared-800 dark:bg-shared-100 dark:text-shared-700">
          <Users className="w-3 h-3" />
          Shared
        </span>
      )}
    </div>
  );
}

export function DevicesCell({ item: wallet }: WalletCellProps) {
  return (
    <div className="text-sm text-sanctuary-900 dark:text-sanctuary-100">
      {wallet.deviceCount} device{wallet.deviceCount !== 1 ? 's' : ''}
    </div>
  );
}
