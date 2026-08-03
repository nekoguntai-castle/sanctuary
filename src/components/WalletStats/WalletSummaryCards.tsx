import React from 'react';
import { CalendarClock, Clock, Coins, DollarSign, type LucideIcon } from 'lucide-react';
import type { AgeDisplay } from './walletStatsData';

type SatsFormatter = (sats: number) => string;

interface WalletSummaryCardsProps {
  balance: number;
  btcPrice: number | null;
  currencySymbol: string;
  fiatBalance: number;
  fiatCurrency: string;
  firstActivityAgeDays: number | null;
  format: SatsFormatter;
  oldestTxDate: Date | null;
  showFiat: boolean;
  utxoAge: AgeDisplay;
  utxoCount: number;
}

interface SummaryCardProps {
  caption?: React.ReactNode;
  children: React.ReactNode;
  icon: LucideIcon;
  iconClassName: string;
  label: string;
}

const CARD_CLASS = 'surface-elevated p-4 rounded-xl border border-sanctuary-200 dark:border-sanctuary-800';

function SummaryCard({ caption, children, icon: Icon, iconClassName, label }: SummaryCardProps) {
  return (
    <div className={CARD_CLASS}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-sanctuary-500 uppercase">{label}</span>
        <Icon className={`w-4 h-4 ${iconClassName}`} />
      </div>
      <div className="text-2xl font-bold text-sanctuary-900 dark:text-sanctuary-100">
        {children}
      </div>
      {caption && <div className="text-xs text-sanctuary-400 mt-1">{caption}</div>}
    </div>
  );
}

function getBalanceCaption(showFiat: boolean, btcPrice: number | null, currencySymbol: string): string {
  if (!showFiat) return 'Current Holdings';
  if (btcPrice === null) return 'Loading price...';

  return `@ ${currencySymbol}${btcPrice.toLocaleString()}/BTC`;
}

function getBalanceValue(
  showFiat: boolean,
  fiatBalance: number,
  currencySymbol: string,
  balance: number,
  format: SatsFormatter
): string {
  if (showFiat) {
    return `${currencySymbol}${fiatBalance.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  }

  return format(balance).split(' (')[0];
}

export const WalletSummaryCards: React.FC<WalletSummaryCardsProps> = ({
  balance,
  btcPrice,
  currencySymbol,
  fiatBalance,
  fiatCurrency,
  firstActivityAgeDays,
  format,
  oldestTxDate,
  showFiat,
  utxoAge,
  utxoCount,
}) => (
  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
    <SummaryCard
      icon={DollarSign}
      iconClassName="text-emerald-500"
      label={showFiat ? `${fiatCurrency} Value` : 'BTC Value'}
      caption={getBalanceCaption(showFiat, btcPrice, currencySymbol)}
    >
      {getBalanceValue(showFiat, fiatBalance, currencySymbol, balance, format)}
    </SummaryCard>

    <SummaryCard
      icon={Coins}
      iconClassName="text-zen-accent"
      label="UTXO Count"
      caption="Unspent Outputs"
    >
      {utxoCount}
    </SummaryCard>

    <SummaryCard icon={CalendarClock} iconClassName="text-blue-400" label="Avg UTXO Age">
      {utxoCount > 0 ? (
        <>
          {utxoAge.value}{' '}
          <span className="text-sm font-normal text-sanctuary-500">{utxoAge.unit}</span>
        </>
      ) : (
        <span className="text-sm font-normal text-sanctuary-500">No UTXOs</span>
      )}
    </SummaryCard>

    <SummaryCard
      icon={Clock}
      iconClassName="text-sanctuary-400"
      label="First Activity"
      caption={firstActivityAgeDays === null ? undefined : `${firstActivityAgeDays} days ago`}
    >
      {oldestTxDate ? (
        oldestTxDate.toLocaleDateString(undefined, { month: 'short', year: 'numeric' })
      ) : (
        <span className="text-sm font-normal text-sanctuary-500">No transactions</span>
      )}
    </SummaryCard>
  </div>
);
