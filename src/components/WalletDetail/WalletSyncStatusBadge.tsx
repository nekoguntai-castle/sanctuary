import type { Wallet } from "../../types";
import { Tooltip } from "../ui/Tooltip";
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
  const { icon: Icon, iconClassName, label, detail, className } =
    getWalletSyncStatusDescriptor(wallet, syncing, syncRetryInfo);

  // A native `title=` on this span was unreachable by keyboard and by touch —
  // the two ways a stuck wallet's owner is most likely to be looking at it.
  // States whose description says no more than their label (a bare "Synced")
  // get no tooltip, and so no tab stop that leads nowhere.
  return (
    <Tooltip
      content={detail === label ? null : detail}
      label={`Sync status: ${label}`}
    >
      <span className={className}>
        <Icon className={iconClassName} /> {label}
      </span>
    </Tooltip>
  );
}
