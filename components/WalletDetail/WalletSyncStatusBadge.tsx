import type { Wallet } from "../../types";
import type { SyncRetryInfo } from "./types";
import { getWalletSyncStatusDescriptor } from "./walletSyncStatusBadgeStatus";

interface WalletSyncStatusBadgeProps {
  wallet: Wallet;
  syncing: boolean;
  syncRetryInfo: SyncRetryInfo | null;
}

export function WalletSyncStatusBadge({
  wallet,
  syncing,
  syncRetryInfo,
}: WalletSyncStatusBadgeProps) {
  const { icon: Icon, iconClassName, label, title, className } =
    getWalletSyncStatusDescriptor(wallet, syncing, syncRetryInfo);

  return (
    <span className={className} title={title}>
      <Icon className={iconClassName} /> {label}
    </span>
  );
}
