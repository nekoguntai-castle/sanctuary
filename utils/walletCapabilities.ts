import {
  canWalletRoleEdit,
  parseWalletRole,
} from '@sanctuary/shared/constants/walletRoles';

interface WalletCapabilitySource {
  canEdit?: boolean;
  userRole?: unknown;
}

/**
 * Derive edit capability from a raw wallet role value.
 *
 * Unknown, missing, and null role values fail closed.
 */
export function canEditWalletRole(role: unknown): boolean {
  return canWalletRoleEdit(parseWalletRole(role));
}

/**
 * Resolve whether the current user can edit/send from a wallet-shaped API object.
 *
 * Server-provided `canEdit` is authoritative when present. Older or partial
 * responses can still derive edit capability from a valid `userRole`, while
 * unknown and missing values fail closed.
 */
export function canEditWallet(wallet: WalletCapabilitySource | null | undefined): boolean {
  if (!wallet) return false;
  if (wallet.canEdit !== undefined) return wallet.canEdit === true;
  return canEditWalletRole(wallet.userRole);
}
