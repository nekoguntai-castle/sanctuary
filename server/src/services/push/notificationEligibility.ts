export type TransactionNotificationType = 'received' | 'sent' | 'consolidation';

interface WalletNotificationSettings {
  enabled?: boolean;
  notifyReceived?: boolean;
  notifySent?: boolean;
  notifyConsolidation?: boolean;
}

function getWalletSettings(
  preferences: unknown,
  walletId: string,
): WalletNotificationSettings | undefined {
  if (!preferences || typeof preferences !== 'object') return undefined;
  const telegram = (preferences as { telegram?: unknown }).telegram;
  if (!telegram || typeof telegram !== 'object') return undefined;
  const wallets = (telegram as { wallets?: unknown }).wallets;
  if (!wallets || typeof wallets !== 'object') return undefined;
  return (wallets as Record<string, WalletNotificationSettings>)[walletId];
}

/** Apply the established per-wallet transaction settings shared with Telegram. */
export function isWalletTransactionNotificationEnabled(
  preferences: unknown,
  walletId: string,
  transactionType: string,
): boolean {
  const settings = getWalletSettings(preferences, walletId);
  if (!settings?.enabled) return false;

  switch (transactionType) {
    case 'received':
      return settings.notifyReceived === true;
    case 'sent':
      return settings.notifySent === true;
    case 'consolidation':
      return settings.notifyConsolidation === true;
    default:
      return false;
  }
}
