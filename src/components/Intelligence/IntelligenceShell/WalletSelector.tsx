import type { MouseEvent } from 'react';
import { ChevronDown } from 'lucide-react';
import type { WalletOption } from './types';

interface WalletSelectorProps {
  wallets: WalletOption[];
  selectedWallet?: WalletOption;
  selectedWalletId: string;
  dropdownOpen: boolean;
  onToggleDropdown: (event: MouseEvent<HTMLButtonElement>) => void;
  onSelectWallet: (walletId: string) => void;
}

export function WalletSelector({
  wallets,
  selectedWallet,
  selectedWalletId,
  dropdownOpen,
  onToggleDropdown,
  onSelectWallet,
}: WalletSelectorProps) {
  return (
    <div className="relative">
      <button
        onClick={onToggleDropdown}
        className="flex items-center gap-2 rounded-lg border border-sanctuary-200 bg-white px-3 py-1.5 text-[11px] font-medium text-sanctuary-700 transition-colors hover:border-sanctuary-300 dark:border-sanctuary-800 dark:bg-sanctuary-900 dark:text-sanctuary-300 dark:hover:border-sanctuary-600"
      >
        <span className="max-w-[160px] truncate">
          {selectedWallet?.name ?? 'Select wallet'}
        </span>
        <ChevronDown className="h-3.5 w-3.5" />
      </button>

      {dropdownOpen && (
        <div className="absolute right-0 top-full z-50 mt-1 w-56 rounded-lg border border-sanctuary-200 bg-white py-1 shadow-lg dark:border-sanctuary-800 dark:bg-sanctuary-900">
          {wallets.map((wallet) => (
            <button
              key={wallet.id}
              onClick={() => onSelectWallet(wallet.id)}
              className={`w-full px-3 py-1.5 text-left text-[11px] transition-colors hover:bg-sanctuary-50 dark:hover:bg-sanctuary-800 ${
                wallet.id === selectedWalletId
                  ? 'font-medium text-primary-600 dark:text-primary-300'
                  : 'text-sanctuary-700 dark:text-sanctuary-300'
              }`}
            >
              {wallet.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
