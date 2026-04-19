export interface WalletGridCardStyles {
  isMultisig: boolean;
  cardClass: string;
  badgeColorClass: string;
  iconColorClass: string;
}

export function walletGridCardStyles(isMultisig: boolean): WalletGridCardStyles {
  return {
    isMultisig,
    cardClass: isMultisig
      ? 'card-accent-warning border-sanctuary-200 dark:border-sanctuary-800 hover:border-warning-300 dark:hover:border-warning-600'
      : 'card-accent-success border-sanctuary-200 dark:border-sanctuary-800 hover:border-success-300 dark:hover:border-success-600',
    badgeColorClass: isMultisig
      ? 'bg-warning-100 text-warning-800 border border-warning-200 dark:bg-warning-500/10 dark:text-warning-300 dark:border-warning-500/20'
      : 'bg-success-100 text-success-800 border border-success-200 dark:bg-success-500/10 dark:text-success-300 dark:border-success-500/20',
    iconColorClass: isMultisig
      ? 'bg-warning-50 dark:bg-warning-900/50 text-warning-600 dark:text-warning-400'
      : 'bg-success-50 dark:bg-success-900/50 text-success-600 dark:text-success-400',
  };
}

export function pendingNetClass(net: number): string {
  return net > 0
    ? 'text-success-600 dark:text-success-400'
    : 'text-sent-600 dark:text-sent-400';
}
