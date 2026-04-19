import type { User } from '../../../../types';
import type { WalletShareInfo } from '../../../../src/api/wallets';
import type { AccessSubTab } from '../../types';

export const ACCESS_SUB_TABS: AccessSubTab[] = ['ownership', 'sharing', 'transfers'];

export type WalletAccessRole = 'viewer' | 'signer';
export type WalletShareUser = WalletShareInfo['users'][number];
export type WalletShareGroup = NonNullable<WalletShareInfo['group']>;

export interface OwnerDisplay {
  username: string;
  initial: string;
}

export function getWalletOwnerDisplay(
  walletShareInfo: WalletShareInfo | null,
  user: User | null,
): OwnerDisplay {
  const ownerUsername = walletShareInfo?.users.find((shareUser) => shareUser.role === 'owner')?.username;
  const username = ownerUsername || user?.username || 'You';
  const initial = ownerUsername?.charAt(0).toUpperCase() || user?.username?.charAt(0).toUpperCase() || 'U';

  return {
    username,
    initial,
  };
}

export function getSharedUsers(walletShareInfo: WalletShareInfo | null): WalletShareUser[] {
  return walletShareInfo?.users.filter((shareUser) => shareUser.role !== 'owner') ?? [];
}

export function hasSharedAccess(
  walletShareInfo: WalletShareInfo | null,
  sharedUsers: WalletShareUser[],
): boolean {
  return Boolean(walletShareInfo?.group) || sharedUsers.length > 0;
}
