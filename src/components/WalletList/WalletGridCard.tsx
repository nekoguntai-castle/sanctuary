import type { Wallet } from '../../api/wallets';
import { WalletType } from '@sanctuary/shared/constants/walletIdentity';
import type { PendingData, WalletAmountFormatter, WalletFiatFormatter } from './types';
import type { WalletSparklineResult } from '../../hooks/queries/useWallets';
import { WalletBalance } from './WalletGridCardBalance';
import { WalletMetadata } from './WalletGridCardMetadata';
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
  onOpen,
}: {
  wallet: Wallet;
  pendingData?: PendingData;
  sparkline: WalletSparklineResult;
  format: WalletAmountFormatter;
  formatFiat: WalletFiatFormatter;
  showFiat: boolean;
  onOpen: () => void;
}) {
  const styles = walletGridCardStyles(wallet.type === WalletType.MULTI_SIG);

  return (
    <div
      onClick={onOpen}
      className={`group surface-elevated card-interactive rounded-xl p-6 border cursor-pointer relative overflow-hidden ${styles.cardClass}`}
    >
      <WalletCardTop wallet={wallet} styles={styles} />
      <h3 className="text-lg font-medium text-sanctuary-900 dark:text-sanctuary-100 mb-1 group-hover:text-primary-600 dark:group-hover:text-primary-300 transition-colors">
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
      <WalletMetadata wallet={wallet} />
    </div>
  );
}
