/**
 * Shared Hardware Wallet Path Utilities
 *
 * Common derivation path helpers used across all hardware wallet adapters.
 * Centralizes testnet detection, script type inference, and account path extraction
 * to prevent inconsistencies between adapters.
 */

import { normalizeDerivationPath } from '../../shared/utils/bitcoin';

export type ScriptType = 'p2wpkh' | 'p2sh-p2wpkh' | 'p2pkh' | 'p2tr';

/**
 * Detect whether a derivation path targets testnet (coin type 1).
 * Handles both apostrophe (') and 'h' hardened notation.
 */
export function isTestnetPath(path: string): boolean {
  return path.includes("/1'") || path.includes("/1h");
}

/**
 * Infer the script type from a BIP-44/49/84/86 derivation path.
 * Checks the purpose field (first path component after 'm/').
 */
export function inferScriptTypeFromPath(path: string): ScriptType {
  const normalized = normalizeDerivationPath(path);
  if (normalized.startsWith("m/84'")) return 'p2wpkh';
  if (normalized.startsWith("m/49'")) return 'p2sh-p2wpkh';
  if (normalized.startsWith("m/44'")) return 'p2pkh';
  if (normalized.startsWith("m/86'")) return 'p2tr';
  return 'p2wpkh';
}

/**
 * Extract the account-level path (first 4 components: m/purpose'/coin'/account')
 * from a full derivation path.
 */
export function extractAccountPath(fullPath: string): string {
  const normalized = normalizeDerivationPath(fullPath);
  const parts = normalized.split('/');
  if (parts.length >= 4) {
    return parts.slice(0, 4).join('/');
  }
  return normalized;
}

