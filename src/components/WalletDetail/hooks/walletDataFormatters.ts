/**
 * Wallet Data Formatters
 *
 * Pure functions that convert API response objects into the shapes expected
 * by the WalletDetail UI components.  No side-effects -- these only transform
 * data.
 */

import type { Wallet, Device } from "../../../types";
import { WalletType } from "../../../types";
import {
  accountPurposeForWalletType,
  parseWalletType,
} from "@sanctuary/shared/constants/walletIdentity";

// ---------------------------------------------------------------------------
// Wallet formatting
// ---------------------------------------------------------------------------

/**
 * Convert an API wallet response into the component-level Wallet shape.
 *
 * @param apiWallet - The raw wallet object from `walletsApi.getWallet()`
 * @param userId    - The authenticated user's ID (used as ownerId)
 */
export function formatWalletFromApi(apiWallet: Wallet, userId: string): Wallet {
  const walletType = parseWalletType(apiWallet.type) ?? WalletType.SINGLE_SIG;

  return {
    id: apiWallet.id,
    name: apiWallet.name,
    type: walletType,
    network: apiWallet.network,
    balance: apiWallet.balance,
    scriptType: apiWallet.scriptType,
    derivationPath: apiWallet.descriptor || "",
    fingerprint: apiWallet.fingerprint || "",
    label: apiWallet.name,
    xpub: "",
    unit: "sats",
    ownerId: userId,
    groupIds: [],
    quorum:
      apiWallet.quorum && apiWallet.totalSigners
        ? { m: Number(apiWallet.quorum), n: apiWallet.totalSigners }
        : { m: 1, n: 1 },
    descriptor: apiWallet.descriptor,
    deviceIds: [],
    // Sync metadata
    lastSyncedAt: apiWallet.lastSyncedAt,
    // No narrowing cast: the server also writes 'resyncing', and a union that
    // omits it reads as a guarantee this mapper cannot make.
    lastSyncStatus: apiWallet.lastSyncStatus,
    lastSyncError: apiWallet.lastSyncError,
    syncInProgress: apiWallet.syncInProgress,
    // Sharing info
    isShared: apiWallet.isShared,
    sharedWith: apiWallet.sharedWith,
    // User permissions
    userRole: apiWallet.userRole,
    canEdit: apiWallet.canEdit,
  };
}

// ---------------------------------------------------------------------------
// Device formatting
// ---------------------------------------------------------------------------

/**
 * Filter and format the full device list into the devices that belong to a
 * specific wallet, including account-match metadata.
 *
 * @param allDevices  - All devices returned from `devicesApi.getDevices()`
 * @param apiWallet   - The raw API wallet (used for scriptType matching)
 * @param walletId    - The wallet ID to filter by
 * @param userId      - The authenticated user's ID
 */
export function formatDevicesForWallet(
  allDevices: Device[],
  apiWallet: Wallet,
  walletId: string,
  userId: string,
): Device[] {
  const walletType = parseWalletType(apiWallet.type) ?? WalletType.SINGLE_SIG;
  const expectedPurpose = accountPurposeForWalletType(walletType);

  return allDevices
    .filter((d) => d.wallets?.some((w) => w.wallet.id === walletId))
    .map((d) => {
      const accounts = d.accounts || [];
      const exactMatch = accounts.find(
        (a) =>
          a.purpose === expectedPurpose &&
          a.scriptType === apiWallet.scriptType,
      );
      const accountMissing = !exactMatch;

      return {
        id: d.id,
        type: d.type,
        label: d.label,
        fingerprint: d.fingerprint,
        derivationPath:
          exactMatch?.derivationPath ||
          d.derivationPath ||
          "No matching account",
        xpub: exactMatch?.xpub || d.xpub,
        userId,
        accountMissing,
      };
    });
}
