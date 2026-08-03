import { Brain } from 'lucide-react';
import { WalletSelector } from './WalletSelector';
import type { WalletOption, WalletSelectionController } from './types';

interface IntelligenceHeaderProps {
  wallets: WalletOption[];
  walletSelection: WalletSelectionController;
}

export function IntelligenceHeader({ wallets, walletSelection }: IntelligenceHeaderProps) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        <Brain className="h-5 w-5 text-primary-600 dark:text-primary-300" />
        <h1 className="text-lg font-semibold text-sanctuary-800 dark:text-sanctuary-200">
          Intelligence
        </h1>
      </div>

      <WalletSelector
        wallets={wallets}
        selectedWallet={walletSelection.selectedWallet}
        selectedWalletId={walletSelection.selectedWalletId}
        dropdownOpen={walletSelection.dropdownOpen}
        onToggleDropdown={walletSelection.toggleDropdown}
        onSelectWallet={walletSelection.selectWallet}
      />
    </div>
  );
}
