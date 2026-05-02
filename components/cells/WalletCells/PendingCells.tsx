import { ArrowDownLeft, ArrowUpRight } from 'lucide-react';
import type { CurrencyFormatter, WalletCellProps, WalletWithPending } from './types';

function getPendingNetClass(net: number) {
  return net > 0
    ? 'text-success-600 dark:text-success-400'
    : 'text-sent-600 dark:text-sent-400';
}

export function PendingCell({ item: wallet }: WalletCellProps) {
  const pending = wallet.pendingData;

  if (!pending) {
    return <span className="text-sanctuary-300">&mdash;</span>;
  }

  return (
    <div className="inline-flex items-center gap-1">
      {pending.hasIncoming && (
        <span title="Pending received">
          <ArrowDownLeft className="w-4 h-4 text-success-500" />
        </span>
      )}
      {pending.hasOutgoing && (
        <span title="Pending sent">
          <ArrowUpRight className="w-4 h-4 text-sent-500" />
        </span>
      )}
    </div>
  );
}

function PendingBalanceDelta({
  pending,
  format,
}: {
  pending: WalletWithPending['pendingData'];
  format: CurrencyFormatter['format'];
}) {
  if (!pending || pending.net === 0) return null;

  return (
    <span className={`ml-1 text-xs font-normal ${getPendingNetClass(pending.net)}`}>
      ({pending.net > 0 ? '+' : ''}
      {format(pending.net)})
    </span>
  );
}

function PendingFiatDelta({
  pending,
  formatFiat,
  network,
}: {
  pending: WalletWithPending['pendingData'];
  formatFiat: CurrencyFormatter['formatFiat'];
  network?: string | null;
}) {
  if (!pending || pending.net === 0) return null;

  const fiatValue = formatFiat(pending.net, { network });
  if (!fiatValue) return null;

  return (
    <span className={`ml-1 text-[10px] ${getPendingNetClass(pending.net)}`}>
      ({pending.net > 0 ? '+' : ''}
      {fiatValue})
    </span>
  );
}

export function BalanceCell({
  wallet,
  currency,
}: {
  wallet: WalletWithPending;
  currency: CurrencyFormatter;
}) {
  const { format, formatFiat, showFiat } = currency;
  const pending = wallet.pendingData;
  const fiatBalance = formatFiat(wallet.balance, { network: wallet.network });

  return (
    <>
      <div className="text-sm font-bold text-sanctuary-900 dark:text-sanctuary-100">
        {format(wallet.balance)}
        <PendingBalanceDelta pending={pending} format={format} />
      </div>
      {showFiat && fiatBalance && (
        <div className="text-xs text-primary-500 dark:text-primary-400">
          {fiatBalance}
          <PendingFiatDelta pending={pending} formatFiat={formatFiat} network={wallet.network} />
        </div>
      )}
    </>
  );
}
