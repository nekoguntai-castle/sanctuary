import type { AddressListType } from '../../services/vaultPolicy/types';
import prisma from '../../models/prisma';
import { policyRepository } from '../policyRepository';
import { walletRepository } from '../walletRepository';

const POLICY_DETAIL_ADDRESS_LIMIT = 101;

function policyIsVisibleForWallet(
  policy: { walletId: string | null; groupId: string | null; sourceType: string },
  wallet: { id: string; groupId: string | null }
): boolean {
  if (policy.walletId === wallet.id) return true;
  if (policy.sourceType === 'system' && policy.walletId === null && policy.groupId === null) return true;
  return policy.groupId !== null && policy.groupId === wallet.groupId;
}

function findPolicyAddressRows(policyId: string, listType?: AddressListType) {
  return prisma.policyAddress.findMany({
    where: {
      policyId,
      ...(listType && { listType }),
    },
    orderBy: { createdAt: 'desc' },
    take: POLICY_DETAIL_ADDRESS_LIMIT,
  });
}

export async function findWalletPoliciesForAssistant(
  walletId: string,
  includeInherited: boolean
) {
  const wallet = await walletRepository.findById(walletId);
  if (!wallet) {
    return { wallet: null, policies: [] };
  }

  const walletPolicies = await policyRepository.findAllPoliciesForWallet(walletId);
  if (!includeInherited) {
    return { wallet, policies: walletPolicies };
  }

  const [systemPolicies, groupPolicies] = await Promise.all([
    policyRepository.findSystemPolicies(),
    wallet.groupId ? policyRepository.findGroupPolicies(wallet.groupId) : Promise.resolve([]),
  ]);

  return {
    wallet,
    policies: [...systemPolicies, ...groupPolicies, ...walletPolicies],
  };
}

export async function findWalletPolicyDetailForAssistant(
  walletId: string,
  policyId: string,
  listType?: AddressListType
) {
  const wallet = await walletRepository.findById(walletId);
  if (!wallet) return null;

  const policy = await policyRepository.findPolicyById(policyId);
  if (!policy || !policyIsVisibleForWallet(policy, wallet)) return null;

  const [addresses, eventResult] = await Promise.all([
    findPolicyAddressRows(policy.id, listType),
    policyRepository.findPolicyEvents(walletId, { policyId: policy.id, limit: 10 }),
  ]);

  return {
    policy,
    addresses,
    recentEvents: eventResult.events,
    eventTotal: eventResult.total,
  };
}

export async function findWalletPolicyEventsForAssistant(
  walletId: string,
  options: {
    policyId?: string;
    eventType?: string;
    from?: Date;
    to?: Date;
    limit?: number;
  }
) {
  return policyRepository.findPolicyEvents(walletId, options);
}
