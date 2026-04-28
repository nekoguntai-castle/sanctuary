/**
 * Shared Hardware Wallet Path Utilities
 *
 * Common derivation path helpers used across all hardware wallet adapters.
 * Centralizes testnet detection, script type inference, and account path extraction
 * to prevent inconsistencies between adapters.
 */

import {
  normalizeDerivationPath,
  parseDerivationPath,
} from "../../shared/utils/bitcoin";

export type ScriptType = "p2wpkh" | "p2sh-p2wpkh" | "p2pkh" | "p2tr";

/**
 * Detect whether a derivation path targets testnet (coin type 1).
 * Handles both apostrophe (') and 'h' hardened notation.
 */
export function isTestnetPath(path: string): boolean {
  return parseDerivationPath(path).coinType === 1;
}

/**
 * Infer the script type from a BIP-44/49/84/86 derivation path.
 * Checks the purpose field (first path component after 'm/').
 */
export function inferScriptTypeFromPath(path: string): ScriptType {
  switch (parseDerivationPath(path).scriptType) {
    case "native_segwit":
      return "p2wpkh";
    case "nested_segwit":
      return "p2sh-p2wpkh";
    case "legacy":
      return "p2pkh";
    case "taproot":
      return "p2tr";
    case "unknown":
      return "p2wpkh";
  }
}

/**
 * Extract the account-level path (first 4 components: m/purpose'/coin'/account')
 * from a full derivation path.
 */
export function extractAccountPath(fullPath: string): string {
  const parsed = parseDerivationPath(fullPath);
  return parsed.accountPath ?? normalizeDerivationPath(fullPath);
}
