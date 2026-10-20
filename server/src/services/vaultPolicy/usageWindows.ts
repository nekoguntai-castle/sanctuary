/**
 * Usage windows that enforce-mode spending-limit and velocity policies reserve.
 *
 * Shared by the broadcast-time reservation (policyEvaluationEngine) and the
 * read-only payjoin check, so the two cannot drift: a payjoin original may be
 * broadcast by the receiver, outside any Sanctuary reservation, so payjoin is
 * refused whenever a reservation would apply (C-D8).
 */

import type { VaultPolicy } from '../../generated/prisma/client';
import { walletRepository } from '../../repositories/walletRepository';
import type { SpendingLimitConfig, VelocityConfig, WindowType } from './types';
import { vaultPolicyService } from './vaultPolicyService';

export interface UsageWindowCheck {
  type: WindowType;
  limit: number;
}

const positiveWindows = (windows: Array<[WindowType, number | undefined]>): UsageWindowCheck[] =>
  windows.flatMap(([type, limit]) => (limit && limit > 0 ? [{ type, limit }] : []));

/** The windows a spending_limit or velocity policy reserves; none for any other type. */
export const usageWindowChecks = (policy: Pick<VaultPolicy, 'type' | 'config'>): UsageWindowCheck[] => {
  if (policy.type === 'spending_limit') {
    const config = policy.config as unknown as SpendingLimitConfig;
    return positiveWindows([['daily', config.daily], ['weekly', config.weekly], ['monthly', config.monthly]]);
  }
  if (policy.type === 'velocity') {
    const config = policy.config as unknown as VelocityConfig;
    return positiveWindows([['hourly', config.maxPerHour], ['daily', config.maxPerDay], ['weekly', config.maxPerWeek]]);
  }
  return [];
};

/** Active wallet, group and system policies whose usage is recorded or reserved. */
export const getActivePoliciesForUsage = async (walletId: string): Promise<VaultPolicy[]> => {
  const wallet = await walletRepository.findById(walletId);
  const groupId = wallet?.groupId ?? null;
  return vaultPolicyService.getActivePoliciesForWallet(walletId, groupId);
};

/** True when broadcasting from this wallet would reserve at least one enforce-mode usage window. */
export const walletHasEnforcedUsageWindows = async (walletId: string): Promise<boolean> => {
  const policies = await getActivePoliciesForUsage(walletId);
  return policies.some(policy => policy.enforcement !== 'monitor' && usageWindowChecks(policy).length > 0);
};
