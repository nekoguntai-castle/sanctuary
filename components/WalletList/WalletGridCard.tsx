import type { Wallet } from '../../src/api/wallets';
import type { PendingData, WalletValueFormatter } from './types';
import { WalletBalance } from './WalletGridCardBalance';
import { WalletMetadata } from './WalletGridCardMetadata';
import { WalletSparkline } from './WalletGridCardSparkline';
import { WalletCardTop } from './WalletGridCardTop';
import { walletGridCardStyles } from './walletGridCardStyles';

export function WalletGridCard({
  wallet,
  pendingData,
  sparklineValues,
  format,
  formatFiat,
  showFiat,
  onOpen,
}: {
  wallet: Wallet;
  pendingData?: PendingData;
  sparklineValues?: number[];
  format: WalletValueFormatter;
  formatFiat: WalletValueFormatter;
  showFiat: boolean;
  onOpen: () => void;
}) {
  const styles = walletGridCardStyles(wallet.type === 'multi_sig');

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
        values={sparklineValues}
      />
      <WalletMetadata wallet={wallet} />
    </div>
  );
}
