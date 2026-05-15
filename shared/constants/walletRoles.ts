/**
 * Canonical wallet role values and capability helpers.
 *
 * This module is intentionally dependency-free so frontend, server, gateway,
 * tests, and OpenAPI schemas can derive wallet role behavior from one source.
 */

export const WALLET_ROLE_VALUES = [
  'owner',
  'approver',
  'signer',
  'viewer',
] as const;

export type WalletRoleValue = (typeof WALLET_ROLE_VALUES)[number];
export type WalletRole = WalletRoleValue | null;

export const WALLET_SHARE_ROLE_VALUES = [
  'viewer',
  'signer',
  'approver',
] as const satisfies readonly WalletRoleValue[];

export type WalletShareRole = (typeof WALLET_SHARE_ROLE_VALUES)[number];

export const WALLET_EDIT_ROLE_VALUES = [
  'owner',
  'signer',
] as const satisfies readonly WalletRoleValue[];

export const WALLET_APPROVE_ROLE_VALUES = [
  'owner',
  'approver',
] as const satisfies readonly WalletRoleValue[];

function includesString<T extends string>(
  values: readonly T[],
  value: unknown,
): value is T {
  return typeof value === 'string' && (values as readonly string[]).includes(value);
}

export function isWalletRole(value: unknown): value is WalletRoleValue {
  return includesString(WALLET_ROLE_VALUES, value);
}

export function parseWalletRole(value: unknown): WalletRole {
  return isWalletRole(value) ? value : null;
}

export function isWalletShareRole(value: unknown): value is WalletShareRole {
  return includesString(WALLET_SHARE_ROLE_VALUES, value);
}

export function parseWalletShareRole(value: unknown): WalletShareRole | null {
  return isWalletShareRole(value) ? value : null;
}

export function canWalletRoleView(role: WalletRole): role is WalletRoleValue {
  return role !== null;
}

export function canWalletRoleEdit(role: WalletRole): boolean {
  return includesString(WALLET_EDIT_ROLE_VALUES, role);
}

export function canWalletRoleApprove(role: WalletRole): boolean {
  return includesString(WALLET_APPROVE_ROLE_VALUES, role);
}

export function canWalletRoleOwn(role: WalletRole): boolean {
  return role === 'owner';
}
