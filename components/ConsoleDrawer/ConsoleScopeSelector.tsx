import React from 'react';
import { WalletCards } from 'lucide-react';
import type { Wallet } from '../../src/api/wallets';
import { GENERAL_SCOPE_ID } from './consoleDrawerUtils';

interface ConsoleScopeSelectorProps {
  wallets: Wallet[];
  selectedWalletId: string;
  onChange: (value: string) => void;
}

export const ConsoleScopeSelector: React.FC<ConsoleScopeSelectorProps> = ({
  wallets,
  selectedWalletId,
  onChange,
}) => (
  <label className="flex items-center gap-2 text-xs text-sanctuary-500 dark:text-sanctuary-400">
    <WalletCards className="h-4 w-4" />
    <select
      aria-label="Console scope"
      value={selectedWalletId}
      onChange={(event) => onChange(event.target.value)}
      className="max-w-[220px] rounded-md border border-sanctuary-200 dark:border-sanctuary-700 surface-muted px-2 py-1 text-xs text-sanctuary-800 dark:text-sanctuary-100 focus:outline-none focus:ring-2 focus:ring-primary-500"
    >
      <option value={GENERAL_SCOPE_ID}>General network</option>
      {wallets.map((wallet) => (
        <option key={wallet.id} value={wallet.id}>
          {wallet.name}
        </option>
      ))}
    </select>
  </label>
);
