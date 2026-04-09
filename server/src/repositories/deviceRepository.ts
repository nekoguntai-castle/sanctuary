/**
 * Device Repository
 *
 * Abstracts database operations for devices and device-user associations.
 */

import prisma from '../models/prisma';
import type { Device, DeviceUser, WalletDevice, Prisma } from '../generated/prisma/client';

/**
 * Device with user associations
 */
export interface DeviceWithUsers extends Device {
  users: DeviceUser[];
}

/**
 * Device with full associations
 */
export interface DeviceWithAssociations extends Device {
  users: DeviceUser[];
  wallets: WalletDevice[];
}

/**
 * Create device input
 */
export interface CreateDeviceInput {
  userId: string;
  label: string;
  type: string;
  fingerprint: string;
  xpub: string;
  derivationPath?: string | null;
  modelId?: string | null;
  groupId?: string | null;
  groupRole?: string;
}

/**
 * Find device by ID
 */
export async function findById(deviceId: string): Promise<Device | null> {
  return prisma.device.findUnique({
    where: { id: deviceId },
  });
}

/**
 * Find device by ID with user associations
 */
export async function findByIdWithUsers(
  deviceId: string
): Promise<DeviceWithUsers | null> {
  return prisma.device.findUnique({
    where: { id: deviceId },
    include: { users: true },
  });
}

/**
 * Find device by ID with full associations
 */
export async function findByIdWithAssociations(
  deviceId: string
): Promise<DeviceWithAssociations | null> {
  return prisma.device.findUnique({
    where: { id: deviceId },
    include: { users: true, wallets: true },
  });
}

/**
 * Find device by fingerprint
 */
export async function findByFingerprint(
  fingerprint: string
): Promise<Device | null> {
  return prisma.device.findUnique({
    where: { fingerprint },
  });
}

/**
 * Find all devices for a user (owner or shared)
 */
export async function findByUserId(userId: string): Promise<Device[]> {
  return prisma.device.findMany({
    where: {
      OR: [
        { userId },
        { users: { some: { userId } } },
      ],
    },
    orderBy: { createdAt: 'desc' },
  });
}

/**
 * Find all devices for a user with associations
 */
export async function findByUserIdWithAssociations(
  userId: string
): Promise<DeviceWithAssociations[]> {
  return prisma.device.findMany({
    where: {
      OR: [
        { userId },
        { users: { some: { userId } } },
      ],
    },
    include: { users: true, wallets: true },
    orderBy: { createdAt: 'desc' },
  });
}

/**
 * Find all devices associated with a wallet
 */
export async function findByWalletId(walletId: string): Promise<Device[]> {
  return prisma.device.findMany({
    where: { wallets: { some: { walletId } } },
  });
}

/**
 * Check if user has access to a device (owner or shared)
 */
export async function hasUserAccess(
  deviceId: string,
  userId: string
): Promise<boolean> {
  const device = await prisma.device.findFirst({
    where: {
      id: deviceId,
      OR: [
        { userId },
        { users: { some: { userId } } },
      ],
    },
  });
  return device !== null;
}

/**
 * Check if device is shared (has users in DeviceUser table)
 */
export async function isShared(deviceId: string): Promise<boolean> {
  const count = await prisma.deviceUser.count({
    where: { deviceId },
  });
  return count > 0;
}

/**
 * Create a new device
 */
export async function create(input: CreateDeviceInput): Promise<Device> {
  return prisma.device.create({
    data: {
      userId: input.userId,
      label: input.label,
      type: input.type,
      fingerprint: input.fingerprint,
      xpub: input.xpub,
      derivationPath: input.derivationPath,
      modelId: input.modelId,
      groupId: input.groupId,
      groupRole: input.groupRole || 'viewer',
    },
  });
}

/**
 * Update a device
 */
export async function update(
  deviceId: string,
  data: Partial<Pick<Device, 'label' | 'derivationPath' | 'groupId' | 'groupRole'>>
): Promise<Device> {
  return prisma.device.update({
    where: { id: deviceId },
    data,
  });
}

/**
 * Delete a device
 */
export async function deleteDevice(deviceId: string): Promise<void> {
  await prisma.device.delete({
    where: { id: deviceId },
  });
}

/**
 * Add a user to a device (share access)
 */
export async function addUser(
  deviceId: string,
  userId: string
): Promise<DeviceUser> {
  return prisma.deviceUser.create({
    data: { deviceId, userId },
  });
}

/**
 * Remove a user from a device
 */
export async function removeUser(
  deviceId: string,
  userId: string
): Promise<void> {
  await prisma.deviceUser.deleteMany({
    where: { deviceId, userId },
  });
}

/**
 * Get user count for a device (shared users, not including owner)
 */
export async function getSharedUserCount(deviceId: string): Promise<number> {
  return prisma.deviceUser.count({
    where: { deviceId },
  });
}

/**
 * Find device by ID with full details (model, accounts, wallets, owner)
 */
export async function findByIdFull(deviceId: string) {
  return prisma.device.findUnique({
    where: { id: deviceId },
    include: {
      model: true,
      accounts: true,
      wallets: {
        include: {
          wallet: {
            select: {
              id: true,
              name: true,
              type: true,
              scriptType: true,
            },
          },
        },
      },
      user: {
        select: { username: true },
      },
    },
  });
}

/**
 * Find device by ID with model and accounts
 */
export async function findByIdWithModelAndAccounts(deviceId: string) {
  return prisma.device.findUnique({
    where: { id: deviceId },
    include: {
      model: true,
      accounts: true,
    },
  });
}

/**
 * Find device by fingerprint with accounts
 */
export async function findByFingerprintWithAccounts(fingerprint: string) {
  return prisma.device.findUnique({
    where: { fingerprint },
    include: {
      accounts: true,
      model: true,
    },
  });
}

/**
 * Find device by ID with wallets (for delete check)
 */
export async function findByIdWithWallets(deviceId: string) {
  return prisma.device.findUnique({
    where: { id: deviceId },
    include: {
      wallets: {
        include: {
          wallet: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      },
    },
  });
}

/**
 * Create device with owner record and accounts in a transaction
 */
export async function createWithOwnerAndAccounts(
  data: {
    userId: string;
    type: string;
    label: string;
    fingerprint: string;
    derivationPath?: string | null;
    xpub?: string | null;
    modelId?: string | null;
  },
  accounts: Array<{
    purpose: string;
    scriptType: string;
    derivationPath: string;
    xpub: string;
  }>
) {
  return prisma.$transaction(async (tx) => {
    const newDevice = await tx.device.create({
      data: {
        userId: data.userId,
        type: data.type,
        label: data.label,
        fingerprint: data.fingerprint,
        derivationPath: data.derivationPath ?? undefined,
        xpub: data.xpub ?? '',
        modelId: data.modelId ?? undefined,
      },
      include: {
        model: true,
      },
    });

    await tx.deviceUser.create({
      data: {
        deviceId: newDevice.id,
        userId: data.userId,
        role: 'owner',
      },
    });

    for (const account of accounts) {
      await tx.deviceAccount.create({
        data: {
          deviceId: newDevice.id,
          purpose: account.purpose,
          scriptType: account.scriptType,
          derivationPath: account.derivationPath,
          xpub: account.xpub,
        },
      });
    }

    return newDevice;
  });
}

/**
 * Merge new accounts into an existing device in a transaction
 */
export async function mergeAccounts(
  deviceId: string,
  accounts: Array<{
    purpose: string;
    scriptType: string;
    derivationPath: string;
    xpub: string;
  }>
) {
  return prisma.$transaction(async (tx) => {
    const created = [];
    for (const account of accounts) {
      const newAccount = await tx.deviceAccount.create({
        data: {
          deviceId,
          purpose: account.purpose,
          scriptType: account.scriptType,
          derivationPath: account.derivationPath,
          xpub: account.xpub,
        },
      });
      created.push(newAccount);
    }
    return created;
  });
}

/**
 * Update device with model include
 */
export async function updateWithModel(
  deviceId: string,
  data: Record<string, unknown>
) {
  return prisma.device.update({
    where: { id: deviceId },
    data,
    include: {
      model: true,
    },
  });
}

/**
 * Find all accounts for a device
 */
export async function findAccountsByDeviceId(deviceId: string) {
  return prisma.deviceAccount.findMany({
    where: { deviceId },
    orderBy: [
      { purpose: 'asc' },
      { scriptType: 'asc' },
    ],
  });
}

/**
 * Find a specific account by ID and device
 */
export async function findAccountByIdAndDevice(accountId: string, deviceId: string) {
  return prisma.deviceAccount.findFirst({
    where: {
      id: accountId,
      deviceId,
    },
  });
}

/**
 * Find duplicate account (same derivation path or purpose/scriptType)
 */
export async function findDuplicateAccount(
  deviceId: string,
  derivationPath: string,
  purpose: string,
  scriptType: string
) {
  return prisma.deviceAccount.findFirst({
    where: {
      deviceId,
      OR: [
        { derivationPath },
        { purpose, scriptType },
      ],
    },
  });
}

/**
 * Create a device account
 */
export async function createAccount(data: {
  deviceId: string;
  purpose: string;
  scriptType: string;
  derivationPath: string;
  xpub: string;
}) {
  return prisma.deviceAccount.create({ data });
}

/**
 * Count accounts for a device
 */
export async function countAccountsByDeviceId(deviceId: string): Promise<number> {
  return prisma.deviceAccount.count({
    where: { deviceId },
  });
}

/**
 * Delete a device account
 */
export async function deleteAccount(accountId: string): Promise<void> {
  await prisma.deviceAccount.delete({
    where: { id: accountId },
  });
}

/**
 * Find a hardware device model by slug
 */
export async function findHardwareModel(slug: string) {
  return prisma.hardwareDeviceModel.findUnique({
    where: { slug },
  });
}

/**
 * Find hardware device models with filters
 */
export async function findHardwareModels(filters: {
  manufacturer?: string;
  airGapped?: boolean;
  connectivity?: string;
  discontinued?: boolean;
}) {
  const where: Prisma.HardwareDeviceModelWhereInput = {};

  if (filters.manufacturer) {
    where.manufacturer = filters.manufacturer;
  }
  if (filters.airGapped !== undefined) {
    where.airGapped = filters.airGapped;
  }
  if (filters.connectivity) {
    where.connectivity = { has: filters.connectivity };
  }
  if (filters.discontinued !== undefined) {
    where.discontinued = filters.discontinued;
  }

  return prisma.hardwareDeviceModel.findMany({
    where,
    orderBy: [
      { manufacturer: 'asc' },
      { name: 'asc' },
    ],
  });
}

/**
 * Find distinct manufacturers
 */
export async function findManufacturers() {
  const manufacturers = await prisma.hardwareDeviceModel.findMany({
    where: { discontinued: false },
    select: { manufacturer: true },
    distinct: ['manufacturer'],
    orderBy: { manufacturer: 'asc' },
  });
  return manufacturers.map(m => m.manufacturer);
}

// Export as namespace
export const deviceRepository = {
  findById,
  findByIdWithUsers,
  findByIdWithAssociations,
  findByFingerprint,
  findByUserId,
  findByUserIdWithAssociations,
  findByWalletId,
  hasUserAccess,
  isShared,
  create,
  update,
  delete: deleteDevice,
  addUser,
  removeUser,
  getSharedUserCount,
  findByIdFull,
  findByIdWithModelAndAccounts,
  findByFingerprintWithAccounts,
  findByIdWithWallets,
  createWithOwnerAndAccounts,
  mergeAccounts,
  updateWithModel,
  findAccountsByDeviceId,
  findAccountByIdAndDevice,
  findDuplicateAccount,
  createAccount,
  countAccountsByDeviceId,
  deleteAccount,
  findHardwareModel,
  findHardwareModels,
  findManufacturers,
};

export default deviceRepository;
