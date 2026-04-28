/**
 * Device Account Conflict Detection
 *
 * Types and utilities for comparing incoming device accounts
 * against existing accounts to detect new, matching, and conflicting entries.
 */
import { parseDerivationPath } from "../../../shared/utils/bitcoin";

/**
 * Account type for multi-account device registration
 */
export interface DeviceAccountInput {
  purpose: "single_sig" | "multisig";
  scriptType: "native_segwit" | "nested_segwit" | "taproot" | "legacy";
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

const validPurposes = new Set<DeviceAccountInput["purpose"]>([
  "single_sig",
  "multisig",
]);
const validScriptTypes = new Set<DeviceAccountInput["scriptType"]>([
  "native_segwit",
  "nested_segwit",
  "taproot",
  "legacy",
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
  existingAccounts: Array<{
    derivationPath: string;
    xpub: string;
    purpose: string;
    scriptType: string;
  }>,
  incomingAccounts: DeviceAccountInput[],
): AccountComparisonResult {
  const newAccounts: DeviceAccountInput[] = [];
  const matchingAccounts: DeviceAccountInput[] = [];
  const conflictingAccounts: AccountComparisonResult["conflictingAccounts"] =
    [];

  for (const incoming of incomingAccounts) {
    const existing = existingAccounts.find(
      (e) => e.derivationPath === incoming.derivationPath,
    );
    if (!existing) {
      newAccounts.push(incoming);
    } else if (existing.xpub === incoming.xpub) {
      matchingAccounts.push(incoming);
    } else {
      conflictingAccounts.push({
        incoming,
        existing: {
          derivationPath: existing.derivationPath,
          xpub: existing.xpub,
        },
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
  derivationPath: string | undefined,
): { accounts: DeviceAccountInput[] } | { error: string } {
  if (accounts && accounts.length > 0) {
    return normalizeMultiAccountInput(accounts);
  }

  if (xpub && derivationPath) {
    return buildLegacyAccount(xpub, derivationPath);
  }

  if (xpub) {
    return { accounts: [] };
  }

  return { error: "Either xpub or accounts array is required" };
}

function normalizeMultiAccountInput(
  accounts: DeviceAccountInput[],
): { accounts: DeviceAccountInput[] } | { error: string } {
  const error = findInvalidAccountError(accounts);
  return error ? { error } : { accounts };
}

function findInvalidAccountError(
  accounts: DeviceAccountInput[],
): string | null {
  for (const account of accounts) {
    const error = validateAccount(account);
    if (error) return error;
  }

  return null;
}

function validateAccount(account: DeviceAccountInput): string | null {
  if (
    !account.purpose ||
    !account.scriptType ||
    !account.derivationPath ||
    !account.xpub
  ) {
    return "Each account must have purpose, scriptType, derivationPath, and xpub";
  }

  if (!validPurposes.has(account.purpose)) {
    return 'Account purpose must be "single_sig" or "multisig"';
  }

  if (!validScriptTypes.has(account.scriptType)) {
    return "Account scriptType must be one of: native_segwit, nested_segwit, taproot, legacy";
  }

  return null;
}

/**
 * Normalize legacy single-account payloads only when derivation metadata is
 * complete enough to infer the account family and script policy safely.
 */
function buildLegacyAccount(
  xpub: string,
  derivationPath: string,
): { accounts: DeviceAccountInput[] } | { error: string } {
  const parsed = parseDerivationPath(derivationPath);
  if (!parsed.valid || parsed.accountPath === null) {
    return {
      error:
        "Legacy account derivationPath is invalid; use accounts[] with explicit purpose and scriptType",
    };
  }

  if (parsed.accountPurpose === "unknown" || parsed.scriptType === "unknown") {
    return {
      error:
        "Legacy account derivationPath has unknown purpose; use accounts[] with explicit purpose and scriptType",
    };
  }

  return {
    accounts: [
      {
        purpose: parsed.accountPurpose,
        scriptType: parsed.scriptType,
        derivationPath,
        xpub,
      },
    ],
  };
}
