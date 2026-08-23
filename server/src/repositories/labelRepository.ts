/**
 * Label Repository
 *
 * Abstracts database operations for labels and label associations.
 * Provides centralized access patterns for label management.
 */

import prisma, { type PrismaTxClient } from '../models/prisma';
import type { Label } from '../generated/prisma/client';

/**
 * Label with usage counts
 */
export interface LabelWithCounts extends Label {
  transactionCount: number;
  addressCount: number;
}

/**
 * Label with full associations
 */
export interface LabelWithAssociations extends Label {
  transactions: Array<{
    id: string;
    txid: string;
    type: string;
    amount: bigint;
    confirmations: number;
    blockTime: Date | null;
  }>;
  addresses: Array<{
    id: string;
    walletId: string;
    address: string;
    derivationPath: string;
    index: number;
    used: boolean;
    branch: number | null;
    coordinateVersion: number | null;
    canonicalPolicyId: string | null;
    canonicalPolicyVersion: number | null;
    scriptPubKey: string | null;
  }>;
}

/**
 * Create label input
 */
export interface CreateLabelInput {
  walletId: string;
  name: string;
  color?: string;
  description?: string | null;
}

/**
 * Update label input
 */
export interface UpdateLabelInput {
  name?: string;
  color?: string;
  description?: string | null;
}

/**
 * Find all labels for a wallet with usage counts
 */
export async function findByWalletId(walletId: string): Promise<LabelWithCounts[]> {
  const labels = await prisma.label.findMany({
    where: { walletId },
    include: {
      _count: {
        select: {
          transactionLabels: true,
          addressLabels: true,
        },
      },
    },
    orderBy: { name: 'asc' },
  });

  return labels.map(label => ({
    id: label.id,
    walletId: label.walletId,
    name: label.name,
    color: label.color,
    description: label.description,
    createdAt: label.createdAt,
    updatedAt: label.updatedAt,
    transactionCount: label._count.transactionLabels,
    addressCount: label._count.addressLabels,
  }));
}

/**
 * Find a label by ID
 */
export async function findById(labelId: string): Promise<Label | null> {
  return prisma.label.findUnique({
    where: { id: labelId },
  });
}

/**
 * Find a label by ID with wallet ownership check
 */
export async function findByIdInWallet(
  labelId: string,
  walletId: string
): Promise<Label | null> {
  return prisma.label.findFirst({
    where: { id: labelId, walletId },
  });
}

/**
 * Find a label by ID with all associations
 */
export async function findByIdWithAssociations(
  labelId: string,
  walletId: string
): Promise<LabelWithAssociations | null> {
  const label = await prisma.label.findFirst({
    where: { id: labelId, walletId },
    include: {
      transactionLabels: {
        include: {
          transaction: {
            select: {
              id: true,
              txid: true,
              type: true,
              amount: true,
              confirmations: true,
              blockTime: true,
            },
          },
        },
      },
      addressLabels: {
        include: {
          address: {
            select: {
              id: true,
              walletId: true,
              address: true,
              derivationPath: true,
              index: true,
              used: true,
              branch: true,
              coordinateVersion: true,
              canonicalPolicyId: true,
              canonicalPolicyVersion: true,
              scriptPubKey: true,
            },
          },
        },
      },
    },
  });

  if (!label) return null;

  return {
    id: label.id,
    walletId: label.walletId,
    name: label.name,
    color: label.color,
    description: label.description,
    createdAt: label.createdAt,
    updatedAt: label.updatedAt,
    transactions: label.transactionLabels.map(tl => tl.transaction),
    addresses: label.addressLabels.map(al => al.address),
  };
}

/**
 * Find label by name in wallet (for duplicate checking)
 */
export async function findByNameInWallet(
  walletId: string,
  name: string
): Promise<Label | null> {
  return prisma.label.findFirst({
    where: { walletId, name },
  });
}

/**
 * Check if name is taken by another label
 */
export async function isNameTakenByOther(
  walletId: string,
  name: string,
  excludeLabelId: string
): Promise<boolean> {
  const label = await prisma.label.findFirst({
    where: {
      walletId,
      name,
      id: { not: excludeLabelId },
    },
    select: { id: true },
  });
  return label !== null;
}

/**
 * Create a new label
 */
export async function create(data: CreateLabelInput): Promise<Label> {
  return prisma.label.create({
    data: {
      walletId: data.walletId,
      name: data.name.trim(),
      color: data.color || '#6366f1',
      description: data.description || null,
    },
  });
}

/**
 * Update a label
 */
export async function update(
  labelId: string,
  data: UpdateLabelInput
): Promise<Label> {
  return prisma.label.update({
    where: { id: labelId },
    data: {
      ...(data.name !== undefined && { name: data.name.trim() }),
      ...(data.color !== undefined && { color: data.color }),
      ...(data.description !== undefined && { description: data.description }),
    },
  });
}

/**
 * Delete a label
 */
export async function remove(labelId: string): Promise<void> {
  await prisma.label.delete({
    where: { id: labelId },
  });
}

/**
 * Find labels by IDs in a specific wallet
 */
export async function findManyByIdsInWallet(
  labelIds: string[],
  walletId: string
): Promise<Label[]> {
  return prisma.label.findMany({
    where: {
      id: { in: labelIds },
      walletId,
    },
  });
}

// ========================================
// TRANSACTION LABEL OPERATIONS
// ========================================

/**
 * Get labels for a transaction
 */
export async function getLabelsForTransaction(
  transactionId: string
): Promise<Label[]> {
  const associations = await prisma.transactionLabel.findMany({
    where: { transactionId },
    include: { label: true },
  });
  return associations.map(a => a.label);
}

/**
 * Add labels to a transaction
 */
export async function addLabelsToTransaction(
  transactionId: string,
  labelIds: string[]
): Promise<void> {
  await prisma.transactionLabel.createMany({
    data: labelIds.map(labelId => ({ transactionId, labelId })),
    skipDuplicates: true,
  });
}

/**
 * Replace all labels on a transaction
 */
export async function replaceTransactionLabels(
  transactionId: string,
  labelIds: string[]
): Promise<void> {
  await prisma.$transaction([
    prisma.transactionLabel.deleteMany({ where: { transactionId } }),
    prisma.transactionLabel.createMany({
      data: labelIds.map(labelId => ({ transactionId, labelId })),
    }),
  ]);
}

/**
 * Remove a label from a transaction
 */
export async function removeLabelFromTransaction(
  transactionId: string,
  labelId: string
): Promise<void> {
  await prisma.transactionLabel.deleteMany({
    where: { transactionId, labelId },
  });
}

// ========================================
// ADDRESS LABEL OPERATIONS
// ========================================

/**
 * Get labels for an address
 */
export async function getLabelsForAddress(
  addressId: string
): Promise<Label[]> {
  const associations = await prisma.addressLabel.findMany({
    where: { addressId },
    include: { label: true },
  });
  return associations.map(a => a.label);
}

/**
 * Add labels to an address
 */
export async function addLabelsToAddress(
  addressId: string,
  labelIds: string[],
  client: PrismaTxClient = prisma
): Promise<void> {
  await client.addressLabel.createMany({
    data: labelIds.map(labelId => ({ addressId, labelId })),
    skipDuplicates: true,
  });
}

/**
 * Replace all labels on an address
 */
export async function replaceAddressLabels(
  addressId: string,
  labelIds: string[],
  client?: PrismaTxClient
): Promise<void> {
  const replace = async (tx: PrismaTxClient): Promise<void> => {
    await tx.addressLabel.deleteMany({ where: { addressId } });
    await tx.addressLabel.createMany({
      data: labelIds.map(labelId => ({ addressId, labelId })),
    });
  };
  if (client) return replace(client);
  await prisma.$transaction(replace);
}

/**
 * Remove a label from an address
 */
export async function removeLabelFromAddress(
  addressId: string,
  labelId: string
): Promise<void> {
  await prisma.addressLabel.deleteMany({
    where: { addressId, labelId },
  });
}

/**
 * Find label names for a wallet (for AI context)
 */
export async function findNamesByWalletId(
  walletId: string,
  options?: { take?: number }
): Promise<string[]> {
  const labels = await prisma.label.findMany({
    where: { walletId },
    select: { name: true },
    orderBy: { createdAt: 'desc' },
    take: options?.take,
  });
  return labels.map(l => l.name);
}

// Export all functions as namespace
export const labelRepository = {
  // Label CRUD
  findByWalletId,
  findById,
  findByIdInWallet,
  findByIdWithAssociations,
  findByNameInWallet,
  isNameTakenByOther,
  findManyByIdsInWallet,
  create,
  update,
  remove,
  // Transaction label operations
  getLabelsForTransaction,
  addLabelsToTransaction,
  replaceTransactionLabels,
  removeLabelFromTransaction,
  // Address label operations
  getLabelsForAddress,
  addLabelsToAddress,
  replaceAddressLabels,
  removeLabelFromAddress,
  findNamesByWalletId,
};

export default labelRepository;
