import React from 'react';
import { useCurrency } from '../contexts/CurrencyContext';
import { suppressFiatForNetwork } from '../src/app/networks';
import { useDelayedRender } from '../hooks/useDelayedRender';
import type { Transaction, UTXO } from '../types';
import { WalletStatsCharts } from './WalletStats/WalletStatsCharts';
import { WalletSummaryCards } from './WalletStats/WalletSummaryCards';
import {
  buildAccumulationHistory,
  buildUtxoAgeData,
  formatUtxoAge,
  getAverageUtxoAgeDays,
  getOldestTransactionDate,
  MS_PER_DAY,
} from './WalletStats/walletStatsData';

interface WalletStatsProps {
  utxos: UTXO[];
  balance: number;
  transactions?: Transaction[];
  network?: string | null;
}

export const WalletStats: React.FC<WalletStatsProps> = ({ utxos, balance, transactions = [], network }) => {
  const { getFiatValue, btcPrice, currencySymbol, fiatCurrency, showFiat, format } = useCurrency();
  const chartReady = useDelayedRender();
  const now = Date.now();
  const oldestTxDate = getOldestTransactionDate(transactions);
  const showWalletFiat = showFiat && !suppressFiatForNetwork(network);

  return (
    <div className="space-y-6">
      <WalletSummaryCards
        balance={balance}
        btcPrice={btcPrice}
        currencySymbol={currencySymbol}
        fiatBalance={getFiatValue(balance, { network }) ?? 0}
        fiatCurrency={fiatCurrency}
        firstActivityAgeDays={oldestTxDate ? Math.round((now - oldestTxDate.getTime()) / MS_PER_DAY) : null}
        format={format}
        oldestTxDate={oldestTxDate}
        showFiat={showWalletFiat}
        utxoAge={formatUtxoAge(getAverageUtxoAgeDays(utxos, now))}
        utxoCount={utxos.length}
      />

      <WalletStatsCharts
        accumulationData={buildAccumulationHistory(transactions, balance, now)}
        ageData={buildUtxoAgeData(utxos, now)}
        chartReady={chartReady}
        format={format}
      />
    </div>
  );
};
