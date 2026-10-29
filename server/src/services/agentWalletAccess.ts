/**
 * Agent Wallet Access
 *
 * The wallet roles a wallet agent's user needs, shared by the agent key at
 * runtime (agent/auth.ts) and the admin link (adminAgentService.ts).
 */

import { walletRepository } from '../repositories';
import { canWalletRoleEdit } from '@sanctuary/shared/constants/walletRoles';
import { getUserWalletRole } from './accessControl';

/** Why an agent's user may not use its linked wallets; null when nothing is missing. */
export type AgentWalletAccessProblem = 'funding_access' | 'operational_access' | 'funding_role';

/**
 * An owner or signer role on the funding wallet (creating a funding draft is
 * `requireWalletAccess('edit')` on the human routes) and any role on the
 * operational wallet, which is only read and received into. Problems are
 * reported in the order funding access, operational access, funding role;
 * each caller maps them to its own error.
 */
export async function findAgentWalletAccessProblem(input: {
  userId: string;
  fundingWalletId: string;
  operationalWalletId: string;
}): Promise<AgentWalletAccessProblem | null> {
  const [fundingRole, hasOperationalAccess] = await Promise.all([
    getUserWalletRole(input.fundingWalletId, input.userId),
    walletRepository.hasAccess(input.operationalWalletId, input.userId),
  ]);
  if (fundingRole === null) return 'funding_access';
  if (!hasOperationalAccess) return 'operational_access';
  if (!canWalletRoleEdit(fundingRole)) return 'funding_role';
  return null;
}
