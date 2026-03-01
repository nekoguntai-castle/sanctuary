/**
 * Wallet Service - CRUD Orchestrator
 *
 * Core wallet lifecycle operations (create, read, update, delete).
 * Coordinates between address generation, access control, and descriptor building.
 */

import { db as prisma } from '../../repositories/db';
import * as descriptorBuilder from '../bitcoin/descriptorBuilder';
import { createLogger } from '../../utils/logger';
import { hookRegistry, Operations } from '../hooks';
import { ForbiddenError, InvalidInputError, ConflictError, WalletNotFoundError, DeviceNotFoundError } from '../../errors';
import { getErrorMessage } from '../../utils/errors';
import { generateInitialAddresses } from './addressGeneration';
import type { WalletRole, CreateWalletInput, WalletWithBalance } from './types';

const log = createLogger('WALLET');

// Roles that can edit wallet data (labels, etc.)
const EDIT_ROLES = ['owner', 'signer'];

/**
 * Create a new wallet
 */
export async function createWallet(
  userId: string,
  input: CreateWalletInput
): Promise<WalletWithBalance> {
  // Validate multi-sig parameters
  if (input.type === 'multi_sig') {
    if (!input.quorum || !input.totalSigners) {
      throw new InvalidInputError('Quorum and totalSigners required for multi-sig wallets');
    }
    if (input.quorum > input.totalSigners) {
      throw new InvalidInputError('Quorum cannot exceed total signers');
    }
  }

  let descriptor = input.descriptor;
  let fingerprint = input.fingerprint;

  // If device IDs provided, fetch devices and generate descriptor
  if (input.deviceIds && input.deviceIds.length > 0) {
    // Fetch devices with their accounts
    const devices = await prisma.device.findMany({
      where: {
        id: { in: input.deviceIds },
        userId,
      },
      include: {
        accounts: true,
      },
    });

    if (devices.length !== input.deviceIds.length) {
      throw new DeviceNotFoundError();
    }

    // Validate device count for wallet type
    if (input.type === 'single_sig' && devices.length !== 1) {
      throw new InvalidInputError('Single-sig wallet requires exactly 1 device');
    }
    if (input.type === 'multi_sig' && devices.length < 2) {
      throw new InvalidInputError('Multi-sig wallet requires at least 2 devices');
    }

    // Determine purpose based on wallet type
    const purpose = input.type === 'multi_sig' ? 'multisig' : 'single_sig';

    // Build descriptor from devices, selecting the correct account for wallet type
    const deviceInfos = devices.map(d => {
      // Try to find matching account by purpose and scriptType
      let account = d.accounts.find(
        a => a.purpose === purpose && a.scriptType === input.scriptType
      );

      // If no exact match, try to find any account with matching purpose
      if (!account) {
        account = d.accounts.find(a => a.purpose === purpose);
      }

      // If still no match and we have accounts, log warning and use first account
      if (!account && d.accounts.length > 0) {
        log.warn('No matching account found for wallet type, using first account', {
          deviceId: d.id,
          fingerprint: d.fingerprint,
          walletType: input.type,
          scriptType: input.scriptType,
          availableAccounts: d.accounts.map(a => ({
            purpose: a.purpose,
            scriptType: a.scriptType,
          })),
        });
        account = d.accounts[0];
      }

      // Use account data if found, otherwise fall back to legacy device fields
      const xpub = account?.xpub || d.xpub;
      const derivationPath = account?.derivationPath || d.derivationPath;

      // For multisig, warn if using single-sig account
      if (input.type === 'multi_sig' && account?.purpose === 'single_sig') {
        log.warn('Using single-sig account for multisig wallet - this may cause signing issues', {
          deviceId: d.id,
          fingerprint: d.fingerprint,
          accountPath: account.derivationPath,
          hint: 'Consider adding a multisig account to this device',
        });
      }

      return {
        fingerprint: d.fingerprint,
        xpub,
        derivationPath: derivationPath || undefined,
      };
    });

    const descriptorResult = descriptorBuilder.buildDescriptorFromDevices(
      deviceInfos,
      {
        type: input.type,
        scriptType: input.scriptType,
        network: input.network || 'mainnet',
        quorum: input.quorum,
      }
    );

    descriptor = descriptorResult.descriptor;
    fingerprint = descriptorResult.fingerprint;
  }

  // Create wallet in database with transaction to ensure device linking
  const wallet = await prisma.$transaction(async (tx) => {
    // Create the wallet
    const newWallet = await tx.wallet.create({
      data: {
        name: input.name,
        type: input.type,
        scriptType: input.scriptType,
        network: input.network || 'mainnet',
        quorum: input.quorum,
        totalSigners: input.totalSigners,
        descriptor,
        fingerprint,
        groupId: input.groupId,
        users: {
          create: {
            userId,
            role: 'owner',
          },
        },
      },
    });

    // Link devices to wallet if provided
    if (input.deviceIds && input.deviceIds.length > 0) {
      await tx.walletDevice.createMany({
        data: input.deviceIds.map((deviceId, index) => ({
          walletId: newWallet.id,
          deviceId,
          signerIndex: index,
        })),
      });
    }

    // Fetch complete wallet with relations
    return tx.wallet.findUnique({
      where: { id: newWallet.id },
      include: {
        devices: true,
        addresses: true,
      },
    });
  });

  if (!wallet) {
    throw new Error('Failed to create wallet');
  }

  // Generate initial addresses if wallet has a descriptor
  if (descriptor) {
    try {
      const network = (input.network || 'mainnet') as 'mainnet' | 'testnet' | 'regtest';
      const addressesToCreate = generateInitialAddresses(wallet.id, descriptor, network);
      await prisma.address.createMany({ data: addressesToCreate });
    } catch (err) {
      log.error('Failed to generate initial addresses', { error: err });
      // Don't fail wallet creation if address generation fails
    }
  }

  // Re-fetch wallet with addresses
  const walletWithAddresses = await prisma.wallet.findUnique({
    where: { id: wallet.id },
    include: {
      devices: true,
      addresses: true,
    },
  });

  const result = {
    ...wallet,
    balance: 0,
    deviceCount: wallet.devices.length,
    addressCount: walletWithAddresses?.addresses.length || 0,
    isShared: false,
  };

  // Execute after hooks for audit logging
  hookRegistry.executeAfter(Operations.WALLET_CREATE, input, {
    userId,
    result,
    success: true,
  }).catch(err => log.warn('After hook failed', { error: err }));

  return result;
}

/**
 * Get all wallets for a user
 * OPTIMIZED: Uses aggregate queries for balance instead of loading all UTXOs
 */
export async function getUserWallets(userId: string): Promise<WalletWithBalance[]> {
  // First, get wallet IDs and basic info
  const wallets = await prisma.wallet.findMany({
    where: {
      OR: [
        { users: { some: { userId } } },
        { group: { members: { some: { userId } } } },
      ],
    },
    include: {
      devices: { select: { id: true } },
      addresses: { select: { id: true } },
      // Include sharing info
      group: {
        select: { name: true },
      },
      users: {
        select: { userId: true, role: true },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  if (wallets.length === 0) {
    return [];
  }

  // Fetch balances using aggregate query (single query for all wallets)
  const walletIds = wallets.map(w => w.id);
  const balances = await prisma.uTXO.groupBy({
    by: ['walletId'],
    where: {
      walletId: { in: walletIds },
      spent: false,
    },
    _sum: { amount: true },
  });

  // Create balance lookup map
  const balanceMap = new Map(
    balances.map(b => [b.walletId, Number(b._sum.amount || 0)])
  );

  return wallets.map((wallet) => {
    // Get balance from aggregate query
    const balance = balanceMap.get(wallet.id) || 0;

    // Determine if wallet is shared (has group or multiple users)
    const userCount = wallet.users.length;
    const hasGroup = !!wallet.group;
    const isShared = hasGroup || userCount > 1;

    // Determine user's role for this wallet
    // Check direct user access first, then group access
    const directAccess = wallet.users.find(u => u.userId === userId);
    let userRole: WalletRole = null;
    if (directAccess) {
      userRole = directAccess.role as WalletRole;
    } else if (hasGroup) {
      // User has access via group, use the wallet's groupRole
      userRole = (wallet as unknown as { groupRole: string }).groupRole as WalletRole || 'viewer';
    }

    const canEdit = userRole === 'owner' || userRole === 'signer';

    return {
      id: wallet.id,
      name: wallet.name,
      type: wallet.type,
      scriptType: wallet.scriptType,
      network: wallet.network,
      quorum: wallet.quorum,
      totalSigners: wallet.totalSigners,
      descriptor: wallet.descriptor,
      fingerprint: wallet.fingerprint,
      createdAt: wallet.createdAt,
      balance,
      deviceCount: wallet.devices.length,
      addressCount: wallet.addresses.length,
      // Sync metadata
      lastSyncedAt: wallet.lastSyncedAt,
      lastSyncStatus: wallet.lastSyncStatus,
      syncInProgress: wallet.syncInProgress,
      // Sharing info
      isShared,
      sharedWith: isShared ? {
        groupName: wallet.group?.name || null,
        userCount,
      } : undefined,
      // User permissions
      userRole,
      canEdit,
    };
  });
}

/**
 * Get a single wallet by ID
 */
export async function getWalletById(
  walletId: string,
  userId: string
): Promise<WalletWithBalance | null> {
  const wallet = await prisma.wallet.findFirst({
    where: {
      id: walletId,
      OR: [
        { users: { some: { userId } } },
        { group: { members: { some: { userId } } } },
      ],
    },
    include: {
      users: {
        include: {
          user: {
            select: {
              id: true,
              username: true,
            },
          },
        },
      },
      devices: {
        include: {
          device: true,
        },
      },
      addresses: {
        orderBy: { index: 'asc' },
      },
      // Don't load UTXOs - use aggregate query instead
      group: {
        include: {
          members: {
            where: { userId },
            select: { role: true },
          },
        },
      },
    },
  });

  if (!wallet) return null;

  // Use aggregate query for balance (efficient for wallets with many UTXOs)
  const balanceResult = await prisma.uTXO.aggregate({
    where: {
      walletId,
      spent: false,
    },
    _sum: { amount: true },
  });
  const balance = Number(balanceResult._sum.amount || 0);

  // Determine if wallet is shared
  const userCount = wallet.users.length;
  const hasGroup = !!wallet.group;
  const isShared = hasGroup || userCount > 1;

  // Determine user's role for this wallet
  const directAccess = wallet.users.find(wu => wu.userId === userId);
  let userRole: WalletRole = null;

  if (directAccess) {
    // Direct wallet access takes precedence
    userRole = directAccess.role as WalletRole;
  } else if (wallet.group) {
    // Group-based access uses the wallet's groupRole
    userRole = wallet.groupRole as WalletRole;
  }

  const canEdit = userRole !== null && EDIT_ROLES.includes(userRole);

  return {
    id: wallet.id,
    name: wallet.name,
    type: wallet.type,
    scriptType: wallet.scriptType,
    network: wallet.network,
    quorum: wallet.quorum,
    totalSigners: wallet.totalSigners,
    descriptor: wallet.descriptor,
    fingerprint: wallet.fingerprint,
    createdAt: wallet.createdAt,
    balance,
    deviceCount: wallet.devices.length,
    addressCount: wallet.addresses.length,
    // Sync metadata
    lastSyncedAt: wallet.lastSyncedAt,
    lastSyncStatus: wallet.lastSyncStatus,
    syncInProgress: wallet.syncInProgress,
    // Sharing info
    isShared,
    sharedWith: isShared ? {
      groupName: wallet.group?.name || null,
      userCount,
    } : undefined,
    // User permissions
    userRole,
    canEdit,
  };
}

/**
 * Update wallet
 */
export async function updateWallet(
  walletId: string,
  userId: string,
  updates: Partial<{ name: string; descriptor: string }>
): Promise<WalletWithBalance> {
  // Check user has owner role
  const walletUser = await prisma.walletUser.findFirst({
    where: {
      walletId,
      userId,
      role: 'owner',
    },
  });

  if (!walletUser) {
    throw new ForbiddenError('Only wallet owners can update wallet');
  }

  const wallet = await prisma.wallet.update({
    where: { id: walletId },
    data: updates,
    include: {
      devices: true,
      addresses: true,
      // Don't load UTXOs - use aggregate query instead
      group: {
        select: { name: true },
      },
      users: {
        select: { userId: true },
      },
    },
  });

  // Use aggregate query for balance (efficient for wallets with many UTXOs)
  const balanceResult = await prisma.uTXO.aggregate({
    where: {
      walletId,
      spent: false,
    },
    _sum: { amount: true },
  });
  const balance = Number(balanceResult._sum.amount || 0);

  // Determine if wallet is shared
  const userCount = wallet.users.length;
  const hasGroup = !!wallet.group;
  const isShared = hasGroup || userCount > 1;

  return {
    ...wallet,
    balance,
    deviceCount: wallet.devices.length,
    addressCount: wallet.addresses.length,
    isShared,
    sharedWith: isShared ? {
      groupName: wallet.group?.name || null,
      userCount,
    } : undefined,
  };
}

/**
 * Delete wallet
 */
export async function deleteWallet(walletId: string, userId: string): Promise<void> {
  // Check user has owner role
  const walletUser = await prisma.walletUser.findFirst({
    where: {
      walletId,
      userId,
      role: 'owner',
    },
  });

  if (!walletUser) {
    throw new ForbiddenError('Only wallet owners can delete wallet');
  }

  // Unsubscribe from address notifications to prevent memory leak
  const { getSyncService } = await import('../syncService');
  const syncService = getSyncService();
  await syncService.unsubscribeWalletAddresses(walletId);

  // Also clean up notification service subscriptions
  const { notificationService } = await import('../../websocket/notifications');
  await notificationService.unsubscribeWalletAddresses(walletId);

  await prisma.wallet.delete({
    where: { id: walletId },
  });

  // Execute after hooks for audit logging
  hookRegistry.executeAfter(Operations.WALLET_DELETE, { walletId }, {
    userId,
    success: true,
  }).catch(err => log.warn('After hook failed', { error: err }));
}

/**
 * Add device to wallet
 */
export async function addDeviceToWallet(
  walletId: string,
  deviceId: string,
  userId: string,
  signerIndex?: number
): Promise<void> {
  // Check user has access to wallet
  const wallet = await prisma.wallet.findFirst({
    where: {
      id: walletId,
      users: { some: { userId } },
    },
    include: {
      devices: {
        include: {
          device: true,
        },
      },
    },
  });

  if (!wallet) {
    throw new WalletNotFoundError(walletId);
  }

  // Check device belongs to user
  const device = await prisma.device.findFirst({
    where: {
      id: deviceId,
      userId,
    },
  });

  if (!device) {
    throw new DeviceNotFoundError(deviceId);
  }

  // Check if device is already attached to this wallet
  const existingLink = wallet.devices.find(wd => wd.deviceId === deviceId);
  if (existingLink) {
    throw new ConflictError('Device is already linked to this wallet');
  }

  // Add device to wallet
  await prisma.walletDevice.create({
    data: {
      walletId,
      deviceId,
      signerIndex,
    },
  });

  // Regenerate descriptor if wallet now has enough devices
  const allDevices = [...wallet.devices.map(wd => wd.device), device];
  const shouldGenerateDescriptor =
    (wallet.type === 'single_sig' && allDevices.length === 1) ||
    (wallet.type === 'multi_sig' && allDevices.length >= (wallet.totalSigners || 2));

  if (shouldGenerateDescriptor && !wallet.descriptor) {
    // Build descriptor from all linked devices
    const deviceInfos = allDevices.map(d => ({
      fingerprint: d.fingerprint,
      xpub: d.xpub,
      derivationPath: d.derivationPath || undefined,
    }));

    try {
      const descriptorResult = descriptorBuilder.buildDescriptorFromDevices(
        deviceInfos,
        {
          type: wallet.type as 'single_sig' | 'multi_sig',
          scriptType: wallet.scriptType as 'native_segwit' | 'nested_segwit' | 'taproot' | 'legacy',
          network: wallet.network as 'mainnet' | 'testnet' | 'regtest',
          quorum: wallet.quorum || undefined,
        }
      );

      // Update wallet with new descriptor
      await prisma.wallet.update({
        where: { id: walletId },
        data: {
          descriptor: descriptorResult.descriptor,
          fingerprint: descriptorResult.fingerprint,
        },
      });

      log.info('Generated descriptor for wallet after device link', {
        walletId,
        deviceCount: allDevices.length,
      });
    } catch (err) {
      // Log but don't fail - device was still added
      log.warn('Failed to generate descriptor after device link', {
        walletId,
        error: getErrorMessage(err),
      });
    }
  }
}

/**
 * Repair wallet descriptor
 *
 * Regenerates the Bitcoin descriptor from attached hardware devices for wallets
 * that have devices linked but are missing a descriptor. This can happen when
 * a multisig wallet is created before all devices are added.
 *
 * Security: Only wallet owners can repair descriptors. This prevents unauthorized
 * users from regenerating descriptors which could theoretically be used to derive
 * addresses. The operation is safe because descriptors are deterministically
 * derived from the immutable device xpubs - the same devices will always
 * produce the same descriptor.
 *
 * @param walletId - The wallet to repair
 * @param userId - The user requesting the repair (must be owner)
 * @returns Success status and message
 * @throws Error if wallet not found or user is not owner
 */
export async function repairWalletDescriptor(
  walletId: string,
  userId: string
): Promise<{ success: boolean; message: string }> {
  const wallet = await prisma.wallet.findFirst({
    where: {
      id: walletId,
      users: { some: { userId, role: 'owner' } },
    },
    include: {
      devices: {
        include: {
          device: true,
        },
      },
    },
  });

  if (!wallet) {
    throw new WalletNotFoundError(walletId);
  }

  if (wallet.descriptor) {
    return { success: true, message: 'Wallet already has a descriptor' };
  }

  const devices = wallet.devices.map(wd => wd.device);

  // Check device count requirements
  if (wallet.type === 'single_sig' && devices.length !== 1) {
    return {
      success: false,
      message: `Single-sig wallet needs exactly 1 device, but has ${devices.length}`
    };
  }

  if (wallet.type === 'multi_sig') {
    const requiredDevices = wallet.totalSigners || 2;
    if (devices.length < requiredDevices) {
      return {
        success: false,
        message: `Multi-sig wallet needs ${requiredDevices} devices, but only has ${devices.length}`
      };
    }
  }

  // Build descriptor from devices
  const deviceInfos = devices.map(d => ({
    fingerprint: d.fingerprint,
    xpub: d.xpub,
    derivationPath: d.derivationPath || undefined,
  }));

  try {
    const descriptorResult = descriptorBuilder.buildDescriptorFromDevices(
      deviceInfos,
      {
        type: wallet.type as 'single_sig' | 'multi_sig',
        scriptType: wallet.scriptType as 'native_segwit' | 'nested_segwit' | 'taproot' | 'legacy',
        network: wallet.network as 'mainnet' | 'testnet' | 'regtest',
        quorum: wallet.quorum || undefined,
      }
    );

    // Update wallet with descriptor
    await prisma.wallet.update({
      where: { id: walletId },
      data: {
        descriptor: descriptorResult.descriptor,
        fingerprint: descriptorResult.fingerprint,
      },
    });

    // Generate initial addresses
    const network = wallet.network as 'mainnet' | 'testnet' | 'regtest';
    const addressesToCreate = generateInitialAddresses(wallet.id, descriptorResult.descriptor, network);

    // skipDuplicates ensures idempotency - if repair is called multiple times
    // or addresses already exist from a partial repair, they won't cause errors
    await prisma.address.createMany({
      data: addressesToCreate,
      skipDuplicates: true,
    });

    log.info('Repaired wallet descriptor', {
      walletId,
      deviceCount: devices.length,
      addressesGenerated: addressesToCreate.length,
    });

    return {
      success: true,
      message: `Generated descriptor and ${addressesToCreate.length} addresses`
    };
  } catch (err) {
    log.error('Failed to repair wallet descriptor', {
      walletId,
      error: getErrorMessage(err),
    });
    throw new Error(`Failed to generate descriptor: ${getErrorMessage(err)}`);
  }
}

/**
 * Get wallet statistics
 * OPTIMIZED: Uses aggregate queries instead of loading all data
 */
export async function getWalletStats(walletId: string, userId: string) {
  // First verify access
  const wallet = await prisma.wallet.findFirst({
    where: {
      id: walletId,
      OR: [
        { users: { some: { userId } } },
        { group: { members: { some: { userId } } } },
      ],
    },
    select: { id: true },
  });

  if (!wallet) {
    throw new WalletNotFoundError(walletId);
  }

  // Use aggregate queries for all statistics (efficient for wallets with many records)
  const [balanceResult, receivedResult, sentResult, transactionCount, utxoCount, addressCount] =
    await Promise.all([
      // Balance from unspent UTXOs
      prisma.uTXO.aggregate({
        where: { walletId, spent: false },
        _sum: { amount: true },
      }),
      // Total received
      prisma.transaction.aggregate({
        where: { walletId, type: 'received' },
        _sum: { amount: true },
      }),
      // Total sent
      prisma.transaction.aggregate({
        where: { walletId, type: 'sent' },
        _sum: { amount: true },
      }),
      // Transaction count
      prisma.transaction.count({ where: { walletId } }),
      // UTXO count (unspent only)
      prisma.uTXO.count({ where: { walletId, spent: false } }),
      // Address count
      prisma.address.count({ where: { walletId } }),
    ]);

  return {
    balance: Number(balanceResult._sum.amount || 0),
    received: Number(receivedResult._sum.amount || 0),
    sent: Number(sentResult._sum.amount || 0),
    transactionCount,
    utxoCount,
    addressCount,
  };
}
