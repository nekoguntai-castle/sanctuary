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
      // New account - path doesn't exist
      newAccounts.push(incoming);
    } else if (existing.xpub === incoming.xpub) {
      // Matching account - same path and xpub
      matchingAccounts.push(incoming);
    } else {
      // Conflicting account - same path but different xpub
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
 * Returns null with an error message if validation fails.
 */
export function normalizeIncomingAccounts(
  accounts: DeviceAccountInput[] | undefined,
  xpub: string | undefined,
  derivationPath: string | undefined
): { accounts: DeviceAccountInput[] } | { error: string } {
  if (accounts && accounts.length > 0) {
    for (const account of accounts) {
      if (!account.purpose || !account.scriptType || !account.derivationPath || !account.xpub) {
        return { error: 'Each account must have purpose, scriptType, derivationPath, and xpub' };
      }
      if (!['single_sig', 'multisig'].includes(account.purpose)) {
        return { error: 'Account purpose must be "single_sig" or "multisig"' };
      }
      if (!['native_segwit', 'nested_segwit', 'taproot', 'legacy'].includes(account.scriptType)) {
        return { error: 'Account scriptType must be one of: native_segwit, nested_segwit, taproot, legacy' };
      }
    }
    return { accounts };
  }

  if (xpub && derivationPath) {
    // Convert legacy single account to accounts array format
    const purpose = derivationPath.startsWith("m/48'") ? 'multisig' : 'single_sig';
    let scriptType: DeviceAccountInput['scriptType'] = 'native_segwit';
    if (derivationPath.startsWith("m/86'")) scriptType = 'taproot';
    else if (derivationPath.startsWith("m/49'")) scriptType = 'nested_segwit';
    else if (derivationPath.startsWith("m/44'")) scriptType = 'legacy';

    return { accounts: [{ purpose, scriptType, derivationPath, xpub }] };
  }

  // Legacy xpub-only payload without derivationPath: proceed with no derived accounts.
  // The caller's early guard already rejects payloads missing both xpub and accounts,
  // so reaching here means xpub is present but derivationPath is absent.
  if (xpub) {
    return { accounts: [] };
  }

  return { error: 'Either xpub or accounts array is required' };
}
