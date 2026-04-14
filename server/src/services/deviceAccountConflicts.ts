/**
 * Device Account Conflict Detection
 *
 * Types and utilities for comparing incoming device accounts
 * against existing accounts to detect new, matching, and conflicting entries.
 */

/**
 * Account type for multi-account device registration
 */
export interface DeviceAccountInput {
  purpose: 'single_sig' | 'multisig';
  scriptType: 'native_segwit' | 'nested_segwit' | 'taproot' | 'legacy';
  derivationPath: string;
  xpub: string;
}

/**
 * Result of comparing incoming accounts with existing accounts
 */
export interface AccountComparisonResult {
  newAccounts: DeviceAccountInput[];
  matchingAccounts: DeviceAccountInput[];
  conflictingAccounts: Array<{
    incoming: DeviceAccountInput;
    existing: { derivationPath: string; xpub: string };
  }>;
}

const validPurposes = new Set<DeviceAccountInput['purpose']>(['single_sig', 'multisig']);
const validScriptTypes = new Set<DeviceAccountInput['scriptType']>([
  'native_segwit',
  'nested_segwit',
  'taproot',
  'legacy',
]);

/**
 * Compare incoming accounts with existing accounts.
 * Returns categorized accounts: new, matching, and conflicting.
 *
 * - New: derivation path doesn't exist in existing accounts
 * - Matching: same derivation path and same xpub
 * - Conflicting: same derivation path but different xpub (security concern)
 */
export function compareAccounts(
  existingAccounts: Array<{ derivationPath: string; xpub: string; purpose: string; scriptType: string }>,
  incomingAccounts: DeviceAccountInput[]
): AccountComparisonResult {
  const newAccounts: DeviceAccountInput[] = [];
  const matchingAccounts: DeviceAccountInput[] = [];
  const conflictingAccounts: AccountComparisonResult['conflictingAccounts'] = [];

  for (const incoming of incomingAccounts) {
    const existing = existingAccounts.find(e => e.derivationPath === incoming.derivationPath);
    if (!existing) {
      newAccounts.push(incoming);
    } else if (existing.xpub === incoming.xpub) {
      matchingAccounts.push(incoming);
    } else {
      conflictingAccounts.push({
        incoming,
        existing: { derivationPath: existing.derivationPath, xpub: existing.xpub },
      });
    }
  }

  return { newAccounts, matchingAccounts, conflictingAccounts };
}

/**
 * Normalize incoming accounts from either legacy single-account format
 * or multi-account format into a consistent DeviceAccountInput array.
 *
 * Returns an error message if validation fails.
 */
export function normalizeIncomingAccounts(
  accounts: DeviceAccountInput[] | undefined,
  xpub: string | undefined,
  derivationPath: string | undefined
): { accounts: DeviceAccountInput[] } | { error: string } {
  if (accounts && accounts.length > 0) {
    return normalizeMultiAccountInput(accounts);
  }

  if (xpub && derivationPath) {
    return { accounts: [buildLegacyAccount(xpub, derivationPath)] };
  }

  if (xpub) {
    return { accounts: [] };
  }

  return { error: 'Either xpub or accounts array is required' };
}

function normalizeMultiAccountInput(accounts: DeviceAccountInput[]): { accounts: DeviceAccountInput[] } | { error: string } {
  const error = findInvalidAccountError(accounts);
  return error ? { error } : { accounts };
}

function findInvalidAccountError(accounts: DeviceAccountInput[]): string | null {
  for (const account of accounts) {
    const error = validateAccount(account);
    if (error) return error;
  }

  return null;
}

function validateAccount(account: DeviceAccountInput): string | null {
  if (!account.purpose || !account.scriptType || !account.derivationPath || !account.xpub) {
    return 'Each account must have purpose, scriptType, derivationPath, and xpub';
  }

  if (!validPurposes.has(account.purpose)) {
    return 'Account purpose must be "single_sig" or "multisig"';
  }

  if (!validScriptTypes.has(account.scriptType)) {
    return 'Account scriptType must be one of: native_segwit, nested_segwit, taproot, legacy';
  }

  return null;
}

function buildLegacyAccount(xpub: string, derivationPath: string): DeviceAccountInput {
  return {
    purpose: inferPurpose(derivationPath),
    scriptType: inferScriptType(derivationPath),
    derivationPath,
    xpub,
  };
}

function inferPurpose(derivationPath: string): DeviceAccountInput['purpose'] {
  return derivationPath.startsWith("m/48'") ? 'multisig' : 'single_sig';
}

function inferScriptType(derivationPath: string): DeviceAccountInput['scriptType'] {
  if (derivationPath.startsWith("m/86'")) return 'taproot';
  if (derivationPath.startsWith("m/49'")) return 'nested_segwit';
  if (derivationPath.startsWith("m/44'")) return 'legacy';
  return 'native_segwit';
}
