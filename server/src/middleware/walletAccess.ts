/**
 * Wallet Access Middleware
 *
 * Middleware to verify user has appropriate access level to a wallet.
 * Thin wrapper around the generic resource access middleware factory.
 *
 * The middleware performs exactly one role lookup per request
 * (`getUserWalletRole`, which is cached for 30s) and derives each access
 * level synchronously from the returned role.
 */

import { Request } from 'express';
import { getUserWalletRole, WalletRole } from '../services/wallet';
import { EDIT_ROLES, APPROVE_ROLES } from '../services/wallet/types';
import { createResourceAccessMiddleware } from './resourceAccess';

// Extend Express Request type to include wallet info
declare global {
  namespace Express {
    interface Request {
      walletId?: string;
      walletRole?: WalletRole;
    }
  }
}

export type AccessLevel = 'view' | 'edit' | 'approve' | 'owner';

export const requireWalletAccess = createResourceAccessMiddleware<AccessLevel, WalletRole>({
  resourceName: 'Wallet',
  loggerName: 'MW:WALLET_ACCESS',
  paramNames: ['walletId', 'id'],
  getRole: getUserWalletRole,
  predicates: {
    view: (role) => role !== null,
    edit: (role) => role !== null && EDIT_ROLES.includes(role),
    approve: (role) => role !== null && APPROVE_ROLES.includes(role),
    owner: (role) => role === 'owner',
  },
  attachToRequest: (req: Request, id: string, role: WalletRole) => {
    req.walletId = id;
    req.walletRole = role;
  },
});

/**
 * Helper to check access inline within a handler (for conditional logic)
 * Returns the user's role or null if no access
 */
export async function getWalletAccessRole(
  walletId: string,
  userId: string,
): Promise<WalletRole> {
  return getUserWalletRole(walletId, userId);
}
