import React from 'react';
import { useCurrency } from '../contexts/CurrencyContext';
import { suppressFiatForNetwork } from '../app/networks';
import { useDelayedRender } from '../hooks/useDelayedRender';
import { useBalanceHistory } from '../hooks/queries/useWallets';
import type { Transaction, UTXO } from '../types';
import { WalletStatsCharts } from './WalletStats/WalletStatsCharts';
import { WalletSummaryCards } from './WalletStats/WalletSummaryCards';
import {
  buildAccumulationFromHistory,
  buildAccumulationHistory,
  buildUtxoAgeData,
  formatUtxoAge,
  getAverageUtxoAgeDays,
  getFirstActivityFromHistory,
  getOldestTransactionDate,
  MS_PER_DAY,
} from './WalletStats/walletStatsData';

interface WalletStatsProps {
  walletId: string;
  utxos: UTXO[];
  balance: number;
  transactions?: Transaction[];
  /** True while older transaction pages are unloaded: the loaded list is then partial. */
  hasMoreTx?: boolean;
  network?: string | null;
}

export const WalletStats: React.FC<WalletStatsProps> = ({
  walletId,
  utxos,
  balance,
  transactions = [],
  hasMoreTx = false,
  network,
}) => {
  const { getFiatValue, btcPrice, currencySymbol, fiatCurrency, showFiat, format } = useCurrency();
  const chartReady = useDelayedRender();
  const now = Date.now();
  // Only a wallet with unloaded pages needs the server's full-history series;
  // otherwise the loaded transactions are the whole history.
  const history = useBalanceHistory([walletId], balance, 'ALL', hasMoreTx);
  const historyLoading = hasMoreTx && history.isLoading;
  const historyFailed = hasMoreTx && history.isError;
  // useBalanceHistory substitutes a flat placeholder until real data arrives.
  const fullHistory = hasMoreTx && !history.isLoading && !history.isError ? history.data : null;
  const oldestTxDate = fullHistory
    ? getFirstActivityFromHistory(fullHistory)
    : getOldestTransactionDate(transactions);
  const accumulationData = fullHistory
    ? buildAccumulationFromHistory(fullHistory, now)
    : buildAccumulationHistory(transactions, balance, now);
  const showWalletFiat = showFiat && !suppressFiatForNetwork(network);

  return (
    <div className="space-y-6">
      <WalletSummaryCards
        balance={balance}
        btcPrice={btcPrice}
        currencySymbol={currencySymbol}
        fiatBalance={getFiatValue(balance, { network })}
        fiatCurrency={fiatCurrency}
        firstActivityAgeDays={oldestTxDate ? Math.round((now - oldestTxDate.getTime()) / MS_PER_DAY) : null}
        firstActivityLoading={historyLoading}
        format={format}
        oldestTxDate={oldestTxDate}
        showFiat={showWalletFiat}
        utxoAge={formatUtxoAge(getAverageUtxoAgeDays(utxos, now))}
        utxoCount={utxos.length}
      />

      {historyFailed && (
        <p data-testid="wallet-stats-partial-note" className="text-xs text-sanctuary-500">
          Based on the {transactions.length} most recent transactions
        </p>
      )}

      <WalletStatsCharts
        accumulationData={accumulationData}
        ageData={buildUtxoAgeData(utxos, now)}
        chartReady={chartReady && !historyLoading}
        format={format}
      />
    </div>
  );
};
