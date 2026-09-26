import { Link } from 'react-router-dom';
import type { Wallet } from '../../api/wallets';
import { WalletType } from '@sanctuary/shared/constants/walletIdentity';
import type { PendingData, WalletAmountFormatter, WalletFiatFormatter } from './types';
import type { WalletSparklineResult } from '../../hooks/queries/useWallets';
import { WalletBalance } from './WalletGridCardBalance';
import { WalletMetadata, WalletSyncStatus } from './WalletGridCardMetadata';
import { WalletSparkline } from './WalletGridCardSparkline';
import { WalletCardTop } from './WalletGridCardTop';
import { walletGridCardStyles } from './walletGridCardStyles';

export function WalletGridCard({
  wallet,
  pendingData,
  sparkline,
  format,
  formatFiat,
  showFiat,
  syncNow,
}: {
  wallet: Wallet;
  pendingData?: PendingData;
  sparkline: WalletSparklineResult;
  format: WalletAmountFormatter;
  formatFiat: WalletFiatFormatter;
  showFiat: boolean;
  syncNow?: number;
}) {
  const styles = walletGridCardStyles(wallet.type === WalletType.MULTI_SIG);

  return (
    <div
      className={`group surface-elevated card-interactive rounded-xl border relative min-w-0 overflow-hidden ${styles.cardClass}`}
    >
      <Link
        to={`/wallets/${wallet.id}`}
        aria-label={wallet.name}
        className="flex flex-col h-full p-6 rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-500"
      >
        <WalletCardTop wallet={wallet} styles={styles} />
        <h3 className="[overflow-wrap:anywhere] text-lg font-medium text-sanctuary-900 dark:text-sanctuary-100 mb-1 group-hover:text-primary-600 dark:group-hover:text-primary-300 transition-colors">
          {wallet.name}
        </h3>
        <WalletBalance
          wallet={wallet}
          pendingData={pendingData}
          format={format}
          formatFiat={formatFiat}
          showFiat={showFiat}
        />
        <WalletSparkline
          wallet={wallet}
          isMultisig={styles.isMultisig}
          result={sparkline}
        />
        <div className="mt-auto">
          <WalletMetadata wallet={wallet} />
        </div>
      </Link>
      <div className="absolute bottom-6 right-6 h-4 inline-flex items-center">
        <WalletSyncStatus wallet={wallet} syncNow={syncNow} />
      </div>
    </div>
  );
}
