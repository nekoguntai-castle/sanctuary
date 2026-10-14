/**
 * StatsTab - Wallet statistics view
 *
 * Renders the WalletStats component with UTXO and transaction data.
 */

import React from 'react';
import { WalletStats } from '../../WalletStats';
import type { Transaction, UTXO } from '../../../types';

interface StatsTabProps {
  walletId: string;
  utxos: UTXO[];
  balance: number;
  transactions: Transaction[];
  hasMoreTx: boolean;
  network?: string | null;
}

export const StatsTab: React.FC<StatsTabProps> = ({
  walletId,
  utxos,
  balance,
  transactions,
  hasMoreTx,
  network,
}) => {
  return (
    <WalletStats
      walletId={walletId}
      utxos={utxos}
      balance={balance}
      transactions={transactions}
      hasMoreTx={hasMoreTx}
      network={network}
    />
  );
};
