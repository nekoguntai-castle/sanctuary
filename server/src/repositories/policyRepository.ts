/**
 * Policy Repository
 *
 * Data access layer for vault policies, approval requests, votes, and events.
 */

import prisma from '../models/prisma';
import type { VaultPolicy, ApprovalRequest, ApprovalVote, PolicyEvent, PolicyAddress } from '../generated/prisma/client';
import { Prisma } from '../generated/prisma/client';
import type {
  PolicyType,
  PolicySourceType,
  ApprovalRequestStatus,
  VoteDecision,
  AddressListType,
  WindowType,
} from '../services/vaultPolicy/types';

// ========================================
// VAULT POLICY CRUD
// ========================================

type CreatePolicyInput = {
  walletId?: string;
  groupId?: string;
  name: string;
  description?: string;
  type: PolicyType;
  config: Prisma.InputJsonValue;
  priority?: number;
  enforcement?: string;
  enabled?: boolean;
  createdBy: string;
  sourceType?: PolicySourceType;
  sourceId?: string;
};

const defaultPolicyCreateValues = {
  walletId: null,
  groupId: null,
  description: null,
  priority: 0,
  enforcement: 'enforce',
  enabled: true,
  sourceType: 'wallet',
  sourceId: null,
};

export async function findPoliciesByWalletId(walletId: string): Promise<VaultPolicy[]> {
  return prisma.vaultPolicy.findMany({
    where: { walletId, enabled: true },
    orderBy: { priority: 'asc' },
  });
}

export async function findAllPoliciesForWallet(walletId: string): Promise<VaultPolicy[]> {
  return prisma.vaultPolicy.findMany({
    where: { walletId },
    orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
  });
}

export async function findSystemPolicies(): Promise<VaultPolicy[]> {
  return prisma.vaultPolicy.findMany({
    where: { walletId: null, groupId: null, sourceType: 'system' },
    orderBy: { priority: 'asc' },
  });
}

export async function findGroupPolicies(groupId: string): Promise<VaultPolicy[]> {
  return prisma.vaultPolicy.findMany({
    where: { groupId },
    orderBy: { priority: 'asc' },
  });
}

export async function findPolicyById(policyId: string): Promise<VaultPolicy | null> {
  return prisma.vaultPolicy.findUnique({
    where: { id: policyId },
  });
}

export async function findPolicyByIdInWallet(
  policyId: string,
  walletId: string
): Promise<VaultPolicy | null> {
  return prisma.vaultPolicy.findFirst({
    where: { id: policyId, walletId },
  });
}

export async function createPolicy(data: CreatePolicyInput): Promise<VaultPolicy> {
  return prisma.vaultPolicy.create({
    data: buildPolicyCreateData(data),
  });
}

function buildPolicyCreateData(data: CreatePolicyInput) {
  return {
    ...defaultPolicyCreateValues,
    ...compactNullish({
      walletId: data.walletId,
      groupId: data.groupId,
      description: data.description,
      priority: data.priority,
      enforcement: data.enforcement,
      enabled: data.enabled,
      sourceType: data.sourceType,
      sourceId: data.sourceId,
    }),
    name: data.name,
    type: data.type,
    config: data.config,
    createdBy: data.createdBy,
  };
}

function compactNullish<T extends Record<string, unknown>>(values: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(values).filter(([, value]) => value !== undefined && value !== null)
  ) as Partial<T>;
}

export async function updatePolicy(
  policyId: string,
  data: {
    name?: string;
    description?: string;
    config?: Prisma.InputJsonValue;
    priority?: number;
    enforcement?: string;
    enabled?: boolean;
    updatedBy?: string;
  }
): Promise<VaultPolicy> {
  return prisma.vaultPolicy.update({
    where: { id: policyId },
    data: {
      ...(data.name !== undefined && { name: data.name }),
      ...(data.description !== undefined && { description: data.description }),
      ...(data.config !== undefined && { config: data.config }),
      ...(data.priority !== undefined && { priority: data.priority }),
      ...(data.enforcement !== undefined && { enforcement: data.enforcement }),
      ...(data.enabled !== undefined && { enabled: data.enabled }),
      ...(data.updatedBy !== undefined && { updatedBy: data.updatedBy }),
    },
  });
}

export async function removePolicy(policyId: string): Promise<void> {
  await prisma.vaultPolicy.delete({
    where: { id: policyId },
  });
}

// ========================================
// APPROVAL REQUESTS
// ========================================

export async function findApprovalRequestsByDraftId(
  draftTransactionId: string
): Promise<(ApprovalRequest & { votes: ApprovalVote[] })[]> {
  return prisma.approvalRequest.findMany({
    where: { draftTransactionId },
    include: { votes: true },
    orderBy: { createdAt: 'asc' },
  });
}

export async function findApprovalRequestById(
  requestId: string
): Promise<(ApprovalRequest & { votes: ApprovalVote[] }) | null> {
  return prisma.approvalRequest.findUnique({
    where: { id: requestId },
    include: { votes: true },
  });
}

export async function findPendingApprovalsForUser(
  walletIds: string[]
): Promise<(ApprovalRequest & { votes: ApprovalVote[]; draftTransaction: { walletId: string; recipient: string; amount: bigint } })[]> {
  if (walletIds.length === 0) return [];

  return prisma.approvalRequest.findMany({
    where: {
      status: 'pending',
      draftTransaction: {
        walletId: { in: walletIds },
      },
    },
    include: {
      votes: true,
      draftTransaction: {
        select: { walletId: true, recipient: true, amount: true },
      },
    },
    orderBy: { createdAt: 'asc' },
  });
}

export async function createApprovalRequest(data: {
  draftTransactionId: string;
  policyId: string;
  requiredApprovals: number;
  quorumType?: string;
  allowSelfApproval?: boolean;
  vetoDeadline?: Date;
  expiresAt?: Date;
}): Promise<ApprovalRequest> {
  return prisma.approvalRequest.create({
    data: {
      draftTransactionId: data.draftTransactionId,
      policyId: data.policyId,
      requiredApprovals: data.requiredApprovals,
      quorumType: data.quorumType ?? 'any_n',
      allowSelfApproval: data.allowSelfApproval ?? false,
      vetoDeadline: data.vetoDeadline ?? null,
      expiresAt: data.expiresAt ?? null,
    },
  });
}

export async function updateApprovalRequestStatus(
  requestId: string,
  status: ApprovalRequestStatus,
  resolvedAt?: Date
): Promise<ApprovalRequest> {
  return prisma.approvalRequest.update({
    where: { id: requestId },
    data: {
      status,
      resolvedAt: resolvedAt ?? (status !== 'pending' ? new Date() : null),
    },
  });
}

// ========================================
// APPROVAL VOTES
// ========================================

export async function createVote(data: {
  approvalRequestId: string;
  userId: string;
  decision: VoteDecision;
  reason?: string;
}): Promise<ApprovalVote> {
  return prisma.approvalVote.create({
    data: {
      approvalRequestId: data.approvalRequestId,
      userId: data.userId,
      decision: data.decision,
      reason: data.reason ?? null,
    },
  });
}

export async function findVoteByUserAndRequest(
  approvalRequestId: string,
  userId: string
): Promise<ApprovalVote | null> {
  return prisma.approvalVote.findUnique({
    where: {
      approvalRequestId_userId: {
        approvalRequestId,
        userId,
      },
    },
  });
}

// ========================================
// POLICY EVENTS
// ========================================

export async function createPolicyEvent(data: {
  policyId?: string;
  walletId: string;
  draftTransactionId?: string;
  userId?: string;
  eventType: string;
  details: Prisma.InputJsonValue;
}): Promise<PolicyEvent> {
  return prisma.policyEvent.create({
    data: {
      policyId: data.policyId ?? null,
      walletId: data.walletId,
      draftTransactionId: data.draftTransactionId ?? null,
      userId: data.userId ?? null,
      eventType: data.eventType,
      details: data.details,
    },
  });
}

export async function findPolicyEvents(
  walletId: string,
  options?: {
    policyId?: string;
    eventType?: string;
    from?: Date;
    to?: Date;
    limit?: number;
    offset?: number;
  }
): Promise<{ events: PolicyEvent[]; total: number }> {
  const where: Prisma.PolicyEventWhereInput = {
    walletId,
    ...(options?.policyId && { policyId: options.policyId }),
    ...(options?.eventType && { eventType: options.eventType }),
    ...(options?.from || options?.to
      ? {
          createdAt: {
            ...(options.from && { gte: options.from }),
            ...(options.to && { lte: options.to }),
          },
        }
      : {}),
  };

  const [events, total] = await Promise.all([
    prisma.policyEvent.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: options?.limit ?? 50,
      skip: options?.offset ?? 0,
    }),
    prisma.policyEvent.count({ where }),
  ]);

  return { events, total };
}

// ========================================
// POLICY ADDRESSES
// ========================================

export async function findPolicyAddresses(
  policyId: string,
  listType?: AddressListType
): Promise<PolicyAddress[]> {
  return prisma.policyAddress.findMany({
    where: {
      policyId,
      ...(listType && { listType }),
    },
    orderBy: { createdAt: 'desc' },
  });
}

export async function createPolicyAddress(data: {
  policyId: string;
  address: string;
  label?: string;
  listType: AddressListType;
  addedBy: string;
}): Promise<PolicyAddress> {
  return prisma.policyAddress.create({
    data: {
      policyId: data.policyId,
      address: data.address,
      label: data.label ?? null,
      listType: data.listType,
      addedBy: data.addedBy,
    },
  });
}

export async function removePolicyAddress(addressId: string): Promise<void> {
  await prisma.policyAddress.delete({
    where: { id: addressId },
  });
}

export async function findPolicyAddressByAddress(
  policyId: string,
  address: string
): Promise<PolicyAddress | null> {
  return prisma.policyAddress.findUnique({
    where: {
      policyId_address: {
        policyId,
        address,
      },
    },
  });
}

export async function findPolicyAddressById(
  addressId: string
): Promise<PolicyAddress | null> {
  return prisma.policyAddress.findUnique({
    where: { id: addressId },
  });
}

// ========================================
// POLICY USAGE WINDOWS
// ========================================

export async function findOrCreateUsageWindow(data: {
  policyId: string;
  walletId: string;
  userId?: string;
  windowType: WindowType;
  windowStart: Date;
  windowEnd: Date;
}): Promise<{ id: string; totalSpent: bigint; txCount: number }> {
  // Use find-then-upsert to handle concurrent access safely.
  // The unique constraint on (policyId, walletId, userId, windowType, windowStart)
  // ensures no duplicates even under concurrent requests.
  const resolvedUserId = data.userId ?? null;

  // Try fast path first
  const existing = await prisma.policyUsageWindow.findFirst({
    where: {
      policyId: data.policyId,
      walletId: data.walletId,
      userId: resolvedUserId,
      windowType: data.windowType,
      windowStart: data.windowStart,
    },
  });

  if (existing) {
    return { id: existing.id, totalSpent: existing.totalSpent, txCount: existing.txCount };
  }

  // Create with conflict handling — if another request created it concurrently, retry the find
  try {
    const created = await prisma.policyUsageWindow.create({
      data: {
        policyId: data.policyId,
        walletId: data.walletId,
        userId: resolvedUserId,
        windowType: data.windowType,
        windowStart: data.windowStart,
        windowEnd: data.windowEnd,
        totalSpent: BigInt(0),
        txCount: 0,
      },
    });
    return { id: created.id, totalSpent: created.totalSpent, txCount: created.txCount };
  } catch (error) {
    // Unique constraint violation — another request created it first, fetch it
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const retried = await prisma.policyUsageWindow.findFirst({
        where: {
          policyId: data.policyId,
          walletId: data.walletId,
          userId: resolvedUserId,
          windowType: data.windowType,
          windowStart: data.windowStart,
        },
      });
      if (retried) {
        return { id: retried.id, totalSpent: retried.totalSpent, txCount: retried.txCount };
      }
    }
    throw error;
  }
}

export async function incrementUsageWindow(
  windowId: string,
  amount: bigint
): Promise<void> {
  await prisma.policyUsageWindow.update({
    where: { id: windowId },
    data: {
      totalSpent: { increment: amount },
      txCount: { increment: 1 },
    },
  });
}

export async function decrementUsageWindow(
  windowId: string,
  amount: bigint
): Promise<void> {
  await prisma.policyUsageWindow.update({
    where: { id: windowId },
    data: {
      totalSpent: { decrement: amount },
      txCount: { decrement: 1 },
    },
  });
}

// ========================================
// COUNTS
// ========================================

export async function countPoliciesByWalletId(walletId: string): Promise<number> {
  return prisma.vaultPolicy.count({ where: { walletId } });
}

export async function countPendingApprovalsByDraftId(draftTransactionId: string): Promise<number> {
  return prisma.approvalRequest.count({
    where: { draftTransactionId, status: 'pending' },
  });
}

// ========================================
// Export
// ========================================

export const policyRepository = {
  // Policies
  findPoliciesByWalletId,
  findAllPoliciesForWallet,
  findSystemPolicies,
  findGroupPolicies,
  findPolicyById,
  findPolicyByIdInWallet,
  createPolicy,
  updatePolicy,
  removePolicy,
  countPoliciesByWalletId,
  // Approval requests
  findApprovalRequestsByDraftId,
  findApprovalRequestById,
  findPendingApprovalsForUser,
  createApprovalRequest,
  updateApprovalRequestStatus,
  countPendingApprovalsByDraftId,
  // Votes
  createVote,
  findVoteByUserAndRequest,
  // Events
  createPolicyEvent,
  findPolicyEvents,
  // Addresses
  findPolicyAddresses,
  createPolicyAddress,
  removePolicyAddress,
  findPolicyAddressByAddress,
  findPolicyAddressById,
  // Usage windows
  findOrCreateUsageWindow,
  incrementUsageWindow,
  decrementUsageWindow,
};

export default policyRepository;
