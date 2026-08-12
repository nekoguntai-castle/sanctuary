/**
 * Wallet Queries
 *
 * Read-only operations for retrieving wallet data with optimized
 * aggregate queries for balance computation.
 */

import {
  walletRepository,
  utxoRepository,
  transactionRepository,
  addressRepository,
} from "../../repositories";
import { ForbiddenError, WalletNotFoundError } from "../../errors";
import type { WalletRole, WalletWithBalance } from "./types";
import {
  canWalletRoleEdit,
  parseWalletRole,
} from "@sanctuary/shared/constants/walletRoles";
import { assertWalletHardwareCapabilityById } from "../hardwareWalletCapabilities";

async function canDisplayWalletDerivationMaterial(walletId: string): Promise<boolean> {
  try {
    await assertWalletHardwareCapabilityById(walletId, "display");
    return true;
  } catch (error) {
    if (error instanceof ForbiddenError) return false;
    throw error;
  }
}

const redactDerivationMaterial = <T>(value: T, canDisplay: boolean): T | null => {
  if (!canDisplay) return null;
  return value;
};

/**
 * Get all wallets for a user
 * OPTIMIZED: Uses aggregate queries for balance instead of loading all UTXOs
 */
export async function getUserWallets(
  userId: string,
): Promise<WalletWithBalance[]> {
  // First, get wallet IDs and basic info
  const wallets = await walletRepository.findByUserIdWithInclude(
    userId,
    {
      devices: { select: { id: true } },
      addresses: { select: { id: true } },
      group: { select: { name: true } },
      users: { select: { userId: true, role: true } },
    },
    { createdAt: "desc" },
  );

  if (wallets.length === 0) {
    return [];
  }

  // Fetch balances using aggregate query (single query for all wallets)
  const walletIds = wallets.map((w) => w.id);
  const balanceMapBigint =
    await utxoRepository.getUnspentBalanceForWallets(walletIds);

  // Create balance lookup map (convert BigInt to Number)
  const balanceMap = new Map(
    [...balanceMapBigint.entries()].map(([id, val]) => [id, Number(val)]),
  );

  return Promise.all(wallets.map(async (wallet) => {
    // Get balance from aggregate query
    const balance = balanceMap.get(wallet.id) || 0;

    // Determine if wallet is shared (has group or multiple users)
    const userCount = wallet.users.length;
    const hasGroup = !!wallet.group;
    const isShared = hasGroup || userCount > 1;

    // Determine user's role for this wallet
    // Check direct user access first, then group access
    const directAccess = wallet.users.find((u) => u.userId === userId);
    let userRole: WalletRole = null;
    if (directAccess) {
      userRole = parseWalletRole(directAccess.role);
    } else if (hasGroup) {
      // User has access via group, use the wallet's groupRole
      userRole = parseWalletRole(
        (wallet as unknown as { groupRole?: string | null }).groupRole,
      );
    }

    const canEdit = canWalletRoleEdit(userRole);
    const canDisplay = await canDisplayWalletDerivationMaterial(wallet.id);

    return {
      id: wallet.id,
      name: wallet.name,
      type: wallet.type,
      scriptType: wallet.scriptType,
      network: wallet.network,
      quorum: wallet.quorum,
      totalSigners: wallet.totalSigners,
      descriptor: redactDerivationMaterial(wallet.descriptor, canDisplay),
      fingerprint: redactDerivationMaterial(wallet.fingerprint, canDisplay),
      createdAt: wallet.createdAt,
      balance,
      deviceCount: wallet.devices.length,
      addressCount: wallet.addresses.length,
      // Sync metadata
      lastSyncedAt: wallet.lastSyncedAt,
      lastSyncStatus: wallet.lastSyncStatus,
      lastSyncError: wallet.lastSyncError,
      syncInProgress: wallet.syncInProgress,
      // Sharing info
      isShared,
      sharedWith: isShared
        ? {
            groupName: wallet.group?.name || null,
            userCount,
          }
        : undefined,
      // User permissions
      userRole,
      canEdit,
    };
  }));
}

/**
 * Get a single wallet by ID
 */
export async function getWalletById(
  walletId: string,
  userId: string,
): Promise<WalletWithBalance | null> {
  const wallet = await walletRepository.findByIdWithFullAccess(
    walletId,
    userId,
    {
      users: {
        include: {
          user: {
            select: { id: true, username: true },
          },
        },
      },
      devices: {
        include: { device: true },
      },
      addresses: {
        orderBy: { index: "asc" },
      },
      group: {
        include: {
          members: {
            where: { userId },
            select: { role: true },
          },
        },
      },
    },
  );

  if (!wallet) return null;

  // Use aggregate query for balance (efficient for wallets with many UTXOs)
  const balanceBigint = await utxoRepository.getUnspentBalance(walletId);
  const balance = Number(balanceBigint);

  // Determine if wallet is shared
  const userCount = wallet.users.length;
  const hasGroup = !!wallet.group;
  const isShared = hasGroup || userCount > 1;

  // Determine user's role for this wallet
  const directAccess = wallet.users.find((wu) => wu.userId === userId);
  let userRole: WalletRole = null;

  if (directAccess) {
    // Direct wallet access takes precedence
    userRole = parseWalletRole(directAccess.role);
  } else if (wallet.group) {
    // Group-based access uses the wallet's groupRole
    userRole = parseWalletRole(wallet.groupRole);
  }

  const canEdit = canWalletRoleEdit(userRole);
  const canDisplay = await canDisplayWalletDerivationMaterial(wallet.id);

  return {
    id: wallet.id,
    name: wallet.name,
    type: wallet.type,
    scriptType: wallet.scriptType,
    network: wallet.network,
    quorum: wallet.quorum,
    totalSigners: wallet.totalSigners,
    descriptor: redactDerivationMaterial(wallet.descriptor, canDisplay),
    fingerprint: redactDerivationMaterial(wallet.fingerprint, canDisplay),
    createdAt: wallet.createdAt,
    balance,
    deviceCount: wallet.devices.length,
    addressCount: wallet.addresses.length,
    // Sync metadata
    lastSyncedAt: wallet.lastSyncedAt,
    lastSyncStatus: wallet.lastSyncStatus,
    lastSyncError: wallet.lastSyncError,
    syncInProgress: wallet.syncInProgress,
    // Sharing info
    isShared,
    sharedWith: isShared
      ? {
          groupName: wallet.group?.name || null,
          userCount,
        }
      : undefined,
    // User permissions
    userRole,
    canEdit,
  };
}

/**
 * Get wallet statistics
 * OPTIMIZED: Uses aggregate queries instead of loading all data
 */
export async function getWalletStats(walletId: string, userId: string) {
  // First verify access
  const wallet = await walletRepository.findByIdWithFullAccess(
    walletId,
    userId,
    {},
  );

  if (!wallet) {
    throw new WalletNotFoundError(walletId);
  }

  // Use aggregate queries for all statistics (efficient for wallets with many records)
  const [utxoAgg, txGrouped, transactionCount, utxoCount, addressCount] =
    await Promise.all([
      utxoRepository.aggregateUnspent(walletId),
      transactionRepository.groupByType(walletId),
      transactionRepository.countByWalletId(walletId),
      utxoRepository.countByWalletId(walletId, { spent: false }),
      addressRepository.countByWalletId(walletId),
    ]);

  const receivedGroup = txGrouped.find((g) => g.type === "received");
  const sentGroup = txGrouped.find((g) => g.type === "sent");

  return {
    balance: Number(utxoAgg._sum.amount || 0),
    received: Number(receivedGroup?._sum.amount || 0),
    sent: Number(sentGroup?._sum.amount || 0),
    transactionCount,
    utxoCount,
    addressCount,
  };
}
