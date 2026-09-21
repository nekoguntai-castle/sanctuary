import type { Wallet } from '../../../types';
import { mergeWalletHttpSyncState } from '../../../utils/walletSyncSnapshot';
import type { WalletNameRead } from './walletRenameEpoch';

export function keepOwnedValue<T>(current: T, next: T, ownsRequest: () => boolean): T {
  return ownsRequest() ? next : current;
}

export function applyOwnedWalletRead(
  current: Wallet | null,
  incoming: Wallet,
  read: WalletNameRead,
  ownsRequest: () => boolean,
): Wallet | null {
  return read.canCommit() && ownsRequest()
    ? mergeWalletHttpSyncState(current, incoming)
    : current;
}
