/**
 * Draft Repository
 *
 * Abstracts database operations for draft transactions.
 * Provides centralized access patterns for draft management.
 */

import prisma from '../models/prisma';
import { Prisma } from '../generated/prisma/client';
import type { DraftTransaction } from '../generated/prisma/client';

/**
 * Draft status types
 */
export type DraftStatus = 'unsigned' | 'partial' | 'signed';

/**
 * Create draft input
 */
export interface CreateDraftInput {
  walletId: string;
  userId: string;
  recipient: string;
  amount: bigint;
  feeRate: number;
  selectedUtxoIds: string[];
  enableRBF: boolean;
  subtractFees: boolean;
  sendMax: boolean;
  outputs?: Prisma.InputJsonValue | null;
  inputs?: Prisma.InputJsonValue | null;
  decoyOutputs?: Prisma.InputJsonValue | null;
  payjoinUrl?: string | null;
  isRBF: boolean;
  label?: string | null;
  memo?: string | null;
  psbtBase64: string;
  signedPsbtBase64?: string | null;
  fee: bigint;
  totalInput: bigint;
  totalOutput: bigint;
  changeAmount: bigint;
  changeAddress?: string | null;
  effectiveAmount: bigint;
  inputPaths: string[];
  expiresAt: Date;
}

/**
 * Update draft input
 */
export interface UpdateDraftInput {
  signedPsbtBase64?: string;
  signedDeviceIds?: string[];
  status?: DraftStatus;
  label?: string | null;
  memo?: string | null;
  expectedUpdatedAt?: Date;
}

type DraftCreateDefaults = Pick<
  Prisma.DraftTransactionUncheckedCreateInput,
  | 'outputs'
  | 'inputs'
  | 'decoyOutputs'
  | 'payjoinUrl'
  | 'label'
  | 'memo'
  | 'signedPsbtBase64'
  | 'changeAddress'
  | 'status'
  | 'signedDeviceIds'
>;

function getDefaultDraftCreateValues(): DraftCreateDefaults {
  return {
    outputs: Prisma.DbNull,
    inputs: Prisma.DbNull,
    decoyOutputs: Prisma.DbNull,
    payjoinUrl: null,
    label: null,
    memo: null,
    signedPsbtBase64: null,
    changeAddress: null,
    status: 'unsigned',
    signedDeviceIds: [],
  };
}

/**
 * Find all drafts for a wallet
 */
export async function findByWalletId(walletId: string): Promise<DraftTransaction[]> {
  return prisma.draftTransaction.findMany({
    where: { walletId },
    orderBy: { createdAt: 'desc' },
  });
}

/**
 * Find a draft by ID
 */
export async function findById(draftId: string): Promise<DraftTransaction | null> {
  return prisma.draftTransaction.findUnique({
    where: { id: draftId },
  });
}

/**
 * Find a draft by ID within a specific wallet
 */
export async function findByIdInWallet(
  draftId: string,
  walletId: string
): Promise<DraftTransaction | null> {
  return prisma.draftTransaction.findFirst({
    where: { id: draftId, walletId },
  });
}

/**
 * Find drafts by user ID
 */
export async function findByUserId(userId: string): Promise<DraftTransaction[]> {
  return prisma.draftTransaction.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
  });
}

/**
 * Find expired drafts
 */
export async function findExpired(): Promise<DraftTransaction[]> {
  return prisma.draftTransaction.findMany({
    where: {
      expiresAt: { lt: new Date() },
    },
  });
}

/**
 * Create a new draft
 */
export async function create(data: CreateDraftInput): Promise<DraftTransaction> {
  return prisma.draftTransaction.create({
    data: buildDraftCreateData(data),
  });
}

function buildDraftCreateData(data: CreateDraftInput): Prisma.DraftTransactionUncheckedCreateInput {
  return {
    ...getDefaultDraftCreateValues(),
    ...compactNullish({
      payjoinUrl: data.payjoinUrl,
      label: data.label,
      memo: data.memo,
      signedPsbtBase64: data.signedPsbtBase64,
      changeAddress: data.changeAddress,
    }),
    outputs: toDraftJsonCreateValue(data.outputs),
    inputs: toDraftJsonCreateValue(data.inputs),
    decoyOutputs: toDraftJsonCreateValue(data.decoyOutputs),
    walletId: data.walletId,
    userId: data.userId,
    recipient: data.recipient,
    amount: data.amount,
    feeRate: data.feeRate,
    selectedUtxoIds: data.selectedUtxoIds,
    enableRBF: data.enableRBF,
    subtractFees: data.subtractFees,
    sendMax: data.sendMax,
    isRBF: data.isRBF,
    psbtBase64: data.psbtBase64,
    fee: data.fee,
    totalInput: data.totalInput,
    totalOutput: data.totalOutput,
    changeAmount: data.changeAmount,
    effectiveAmount: data.effectiveAmount,
    inputPaths: data.inputPaths,
    expiresAt: data.expiresAt,
  };
}

function toDraftJsonCreateValue(
  value: Prisma.InputJsonValue | null | undefined
): Prisma.NullableJsonNullValueInput | Prisma.InputJsonValue {
  return value === undefined || value === null ? Prisma.DbNull : value;
}

function compactNullish<T extends Record<string, unknown>>(values: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(values).filter(([, value]) => value !== undefined && value !== null)
  ) as Partial<T>;
}

/**
 * Update a draft
 */
export async function update(
  draftId: string,
  data: UpdateDraftInput
): Promise<DraftTransaction> {
  const updateData = {
    ...(data.signedPsbtBase64 !== undefined && { signedPsbtBase64: data.signedPsbtBase64 }),
    ...(data.signedDeviceIds !== undefined && { signedDeviceIds: data.signedDeviceIds }),
    ...(data.status !== undefined && { status: data.status }),
    ...(data.label !== undefined && { label: data.label }),
    ...(data.memo !== undefined && { memo: data.memo }),
    updatedAt: new Date(),
  };

  // Optional compare-and-swap update for optimistic concurrency control.
  // Useful for signature aggregation where concurrent updates may otherwise
  // overwrite each other.
  if (data.expectedUpdatedAt) {
    const result = await prisma.draftTransaction.updateMany({
      where: {
        id: draftId,
        updatedAt: data.expectedUpdatedAt,
      },
      data: updateData,
    });

    if (result.count === 0) {
      throw new Error('DRAFT_UPDATE_CONFLICT');
    }

    const updated = await prisma.draftTransaction.findUnique({
      where: { id: draftId },
    });

    if (!updated) {
      throw new Error('Draft not found after update');
    }

    return updated;
  }

  return prisma.draftTransaction.update({
    where: { id: draftId },
    data: updateData,
  });
}

/**
 * Delete a draft
 */
export async function remove(draftId: string): Promise<void> {
  await prisma.draftTransaction.delete({
    where: { id: draftId },
  });
}

/**
 * Delete expired drafts
 */
export async function deleteExpired(): Promise<number> {
  const result = await prisma.draftTransaction.deleteMany({
    where: {
      expiresAt: { lt: new Date() },
    },
  });
  return result.count;
}

/**
 * Update the approval status of a draft
 */
export async function updateApprovalStatus(
  draftId: string,
  approvalStatus: string
): Promise<void> {
  await prisma.draftTransaction.update({
    where: { id: draftId },
    data: {
      approvalStatus,
      ...(approvalStatus === 'approved' ? { approvedAt: new Date() } : {}),
    },
  });
}

/**
 * Count drafts for a wallet
 */
export async function countByWalletId(walletId: string): Promise<number> {
  return prisma.draftTransaction.count({
    where: { walletId },
  });
}

/**
 * Count drafts by status for a wallet
 */
export async function countByStatus(
  walletId: string,
  status: DraftStatus
): Promise<number> {
  return prisma.draftTransaction.count({
    where: { walletId, status },
  });
}

/**
 * Delete multiple drafts by IDs (for sync reconciliation when UTXOs are spent)
 */
export async function deleteManyByIds(draftIds: string[]): Promise<number> {
  if (draftIds.length === 0) return 0;
  const result = await prisma.draftTransaction.deleteMany({
    where: { id: { in: draftIds } },
  });
  return result.count;
}

// Export all functions as namespace
export const draftRepository = {
  findByWalletId,
  findById,
  findByIdInWallet,
  findByUserId,
  findExpired,
  create,
  update,
  updateApprovalStatus,
  remove,
  deleteExpired,
  countByWalletId,
  countByStatus,
  deleteManyByIds,
};

export default draftRepository;
