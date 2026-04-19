import { Users } from 'lucide-react';
import { WalletType } from '../../types';
import type { Wallet } from '../../src/api/wallets';
import { getWalletIcon } from '../ui/CustomIcons';
import type { WalletGridCardStyles } from './walletGridCardStyles';

export function WalletCardTop({
  wallet,
  styles,
}: {
  wallet: Wallet;
  styles: WalletGridCardStyles;
}) {
  const walletTypeForIcon = styles.isMultisig ? WalletType.MULTI_SIG : WalletType.SINGLE_SIG;

  return (
    <div className="flex justify-between items-start mb-6">
      <div className={`p-3 rounded-lg ${styles.iconColorClass}`}>
        {getWalletIcon(walletTypeForIcon, 'w-6 h-6')}
      </div>
      <div className="flex flex-col items-end space-y-1">
        <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded ${styles.badgeColorClass}`}>
          {styles.isMultisig ? 'Multisig' : 'Single Sig'}
        </span>
        {wallet.isShared && (
          <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-shared-100 text-shared-800 dark:bg-shared-100 dark:text-shared-700">
            <Users className="w-3 h-3" />
            Shared
          </span>
        )}
      </div>
    </div>
  );
}
