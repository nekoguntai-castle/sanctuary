/**
 * StatsTab - Wallet statistics view
 *
 * Renders the WalletStats component with UTXO and transaction data.
 */

import React from 'react';
import { WalletStats } from '../../WalletStats';
import type { Transaction, UTXO } from '../../../types';

interface StatsTabProps {
  utxos: UTXO[];
  balance: number;
  transactions: Transaction[];
  network?: string | null;
}

export const StatsTab: React.FC<StatsTabProps> = ({ utxos, balance, transactions, network }) => {
  return <WalletStats utxos={utxos} balance={balance} transactions={transactions} network={network} />;
};
