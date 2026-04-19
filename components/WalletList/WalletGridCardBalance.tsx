import { ArrowDownLeft, ArrowUpRight } from 'lucide-react';
import type { Wallet } from '../../src/api/wallets';
import type { PendingData, WalletValueFormatter } from './types';
import { pendingNetClass } from './walletGridCardStyles';

export function WalletBalance({
  wallet,
  pendingData,
  format,
  formatFiat,
  showFiat,
}: {
  wallet: Wallet;
  pendingData?: PendingData;
  format: WalletValueFormatter;
  formatFiat: WalletValueFormatter;
  showFiat: boolean;
}) {
  const fiatBalance = showFiat ? formatFiat(wallet.balance) : null;

  return (
    <div className="mt-2 mb-4">
      <div className="text-lg font-bold font-mono tabular-nums text-sanctuary-900 dark:text-sanctuary-50 flex items-center gap-1.5">
        <span>{format(wallet.balance)}</span>
        {pendingData && (
          <>
            <PendingDirectionIcons pendingData={pendingData} />
            <PendingNetAmount pendingData={pendingData} format={format} className="text-sm font-normal" />
          </>
        )}
      </div>
      {fiatBalance && (
        <div className="text-sm text-primary-500 dark:text-primary-400">
          {fiatBalance}
          {pendingData && (
            <PendingNetAmount pendingData={pendingData} format={formatFiat} className="ml-1 text-xs" />
          )}
        </div>
      )}
    </div>
  );
}

function PendingDirectionIcons({ pendingData }: { pendingData: PendingData }) {
  return (
    <span className="inline-flex items-center gap-0.5">
      {pendingData.hasIncoming && (
        <span title="Pending received"><ArrowDownLeft className="w-3.5 h-3.5 text-success-500" /></span>
      )}
      {pendingData.hasOutgoing && (
        <span title="Pending sent"><ArrowUpRight className="w-3.5 h-3.5 text-sent-500" /></span>
      )}
    </span>
  );
}

function PendingNetAmount({
  pendingData,
  format,
  className,
}: {
  pendingData: PendingData;
  format: WalletValueFormatter;
  className: string;
}) {
  if (pendingData.net === 0) return null;

  return (
    <span className={`${className} ${pendingNetClass(pendingData.net)}`}>
      ({pendingData.net > 0 ? '+' : ''}{format(pendingData.net)})
    </span>
  );
}
