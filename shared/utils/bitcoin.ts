/**
 * Shared Bitcoin Utility Functions
 *
 * These functions are used across frontend, backend, and gateway
 * for Bitcoin value conversion and formatting.
 */

import { SATS_PER_BTC, ADDRESS_PATTERNS } from "../constants/bitcoin";
import type { AddressType } from "../constants/bitcoin";

// Re-export types and constants for convenience
export { SATS_PER_BTC };
export type { AddressType };

/**
 * Convert satoshis to BTC
 */
export function satsToBTC(sats: number): number {
  return sats / SATS_PER_BTC;
}

/**
 * Convert BTC to satoshis
 */
export function btcToSats(btc: number): number {
  return Math.round(btc * SATS_PER_BTC);
}

/**
 * Format satoshis for display with locale-specific formatting
 */
export function formatSats(sats: number, decimals: number = 0): string {
  return sats.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/**
 * Format BTC for display
 * Trims trailing zeros by default for cleaner display
 */
export function formatBTC(
  btc: number,
  decimals: number = 8,
  trimZeros: boolean = true,
): string {
  const formatted = btc.toFixed(decimals);
  if (trimZeros) {
    return formatted.replace(/\.?0+$/, "");
  }
  return formatted;
}

/**
 * Format satoshis as BTC string
 * Convenience function combining satsToBTC and formatBTC
 */
export function formatBTCFromSats(sats: number, decimals: number = 8): string {
  return satsToBTC(sats).toFixed(decimals);
}

/**
 * Quick address format validation using regex patterns
 * Note: This validates format only. Use bitcoinjs-lib on backend for
 * cryptographic validation.
 */
export function isValidAddressFormat(address: string): boolean {
  if (!address || address.length < 26) return false;
  const trimmed = address.trim();
  return Object.values(ADDRESS_PATTERNS).some((pattern) =>
    pattern.test(trimmed),
  );
}

/**
 * Detect address type from format
 * Returns null if address format is not recognized
 */
export function detectAddressType(address: string): AddressType | null {
  if (!address) return null;
  const trimmed = address.trim();

  if (ADDRESS_PATTERNS.legacy.test(trimmed)) return "legacy";
  if (ADDRESS_PATTERNS.p2sh.test(trimmed)) return "p2sh";
  if (ADDRESS_PATTERNS.nativeSegwit.test(trimmed)) return "native_segwit";
  if (ADDRESS_PATTERNS.taproot.test(trimmed)) return "taproot";
  if (ADDRESS_PATTERNS.testnetLegacy.test(trimmed)) return "testnet_legacy";
  if (ADDRESS_PATTERNS.testnetP2sh.test(trimmed)) return "testnet_p2sh";
  if (ADDRESS_PATTERNS.testnetSegwit.test(trimmed)) return "testnet_segwit";

  return null;
}

/**
 * Check if address is on mainnet
 */
export function isMainnetAddress(address: string): boolean {
  const type = detectAddressType(address);
  return type !== null && !type.startsWith("testnet");
}

/**
 * Check if address is on testnet
 */
export function isTestnetAddress(address: string): boolean {
  const type = detectAddressType(address);
  return type !== null && type.startsWith("testnet");
}

// ============================================================================
// DERIVATION PATH UTILITIES
// ============================================================================

/**
 * Account family inferred from a derivation path purpose.
 * `unknown` means the purpose is parseable but not a supported wallet account family.
 */
export type DerivationAccountPurpose = "single_sig" | "multisig" | "unknown";

/**
 * Script policy inferred from standard Bitcoin purpose fields.
 * `unknown` means callers must provide explicit script metadata instead of guessing.
 */
export type DerivationScriptType =
  | "legacy"
  | "nested_segwit"
  | "native_segwit"
  | "taproot"
  | "unknown";

interface DerivationPathComponent {
  index: number;
  hardened: boolean;
}

/**
 * Structured derivation-path metadata.
 * Numeric fields are `null` when the component is missing or malformed.
 * `valid` describes component syntax; `accountPath` is populated only when
 * enough account-depth components are present.
 */
export interface ParsedDerivationPath {
  normalizedPath: string;
  purpose: number | null;
  coinType: number | null;
  accountIndex: number | null;
  scriptPath: number | null;
  changeIndex: number | null;
  addressIndex: number | null;
  accountPath: string | null;
  accountPurpose: DerivationAccountPurpose;
  scriptType: DerivationScriptType;
  valid: boolean;
}

const HARDENED_MARKER = String.fromCharCode(39);

/**
 * Normalize derivation path to use apostrophe notation (')
 * This is the standard notation used by most Bitcoin tools and required by
 * bitcoinjs-lib for proper PSBT bip32Derivation encoding.
 *
 * @example
 * normalizeDerivationPath("m/48h/0h/0h/2h") // => "m/48'/0'/0'/2'"
 * normalizeDerivationPath("48H/0H/0H") // => "m/48'/0'/0'"
 * normalizeDerivationPath("m/84'/0'/0'") // => "m/84'/0'/0'" (unchanged)
 */
export function normalizeDerivationPath(path: string): string {
  const input = typeof path === "string" ? path.trim() : "";
  if (input === "m" || input === "m/") return "m/";

  // Add m/ prefix if missing
  let normalized = input.startsWith("m/") ? input : "m/" + input;
  // Convert h or H to ' (both uppercase and lowercase hardening notation)
  normalized = normalized
    .split("h")
    .join(HARDENED_MARKER)
    .split("H")
    .join(HARDENED_MARKER);
  return normalized;
}

const parseDerivationPathComponent = (
  component: string,
): DerivationPathComponent | null => {
  const hardened = component.endsWith(HARDENED_MARKER);
  const value = hardened ? component.slice(0, -1) : component;
  if (!value || !/^\d+$/.test(value)) return null;

  const index = Number.parseInt(value, 10);
  return Number.isSafeInteger(index) ? { index, hardened } : null;
};

const derivationPathComponents = (path: string): string[] => {
  return path.replace(/^m\/?/, "").split("/").filter(Boolean);
};

const componentIndex = (
  components: Array<DerivationPathComponent | null>,
  index: number,
): number | null => {
  return components[index]?.index ?? null;
};

const accountDepth = (purpose: number | null): number => {
  return purpose === 48 ? 4 : 3;
};

const inferAccountPurpose = (
  purpose: number | null,
): DerivationAccountPurpose => {
  if (purpose === 48) return "multisig";
  if (purpose === 44 || purpose === 49 || purpose === 84 || purpose === 86) {
    return "single_sig";
  }
  return "unknown";
};

const inferDerivationScriptType = (
  purpose: number | null,
  scriptPath: number | null,
): DerivationScriptType => {
  if (purpose === 44) return "legacy";
  if (purpose === 49) return "nested_segwit";
  if (purpose === 84) return "native_segwit";
  if (purpose === 86) return "taproot";
  // BIP48 multisig uses the fourth hardened component as script policy:
  // 1 = nested segwit, 2 = native segwit.
  if (purpose === 48 && scriptPath === 1) return "nested_segwit";
  if (purpose === 48 && scriptPath === 2) return "native_segwit";
  return "unknown";
};

const accountPathFromParts = (
  rawComponents: string[],
  depth: number,
  valid: boolean,
): string | null => {
  if (!valid || rawComponents.length < depth) return null;
  return `m/${rawComponents.slice(0, depth).join("/")}`;
};

/**
 * Parse a BIP32-style derivation path once into structured components.
 *
 * Recognizes common Bitcoin account purposes from BIP44, BIP49, BIP84, BIP86,
 * and BIP48. BIP48 script path `1` maps to nested segwit, and `2` maps to
 * native segwit.
 *
 * Unknown purposes and malformed components are represented explicitly so
 * callers can fail closed instead of guessing a script type.
 */
export function parseDerivationPath(path: string): ParsedDerivationPath {
  const normalizedPath = normalizeDerivationPath(path);
  const rawComponents = derivationPathComponents(normalizedPath);
  const components = rawComponents.map(parseDerivationPathComponent);
  const valid = components.every((component) => component !== null);
  const purpose = componentIndex(components, 0);
  const depth = accountDepth(purpose);
  const scriptPath = purpose === 48 ? componentIndex(components, 3) : null;
  const suffix = components.slice(depth);
  const changeIndex =
    suffix.length >= 2 ? (suffix[suffix.length - 2]?.index ?? null) : null;
  const addressIndex =
    suffix.length >= 1 ? (suffix[suffix.length - 1]?.index ?? null) : null;

  return {
    normalizedPath,
    purpose,
    coinType: componentIndex(components, 1),
    accountIndex: componentIndex(components, 2),
    scriptPath,
    changeIndex,
    addressIndex,
    accountPath: accountPathFromParts(rawComponents, depth, valid),
    accountPurpose: inferAccountPurpose(purpose),
    scriptType: inferDerivationScriptType(purpose, scriptPath),
    valid,
  };
}

/**
 * Format derivation path for use in Bitcoin output descriptors.
 * Descriptors use 'h' notation without the 'm/' prefix.
 *
 * @example
 * formatPathForDescriptor("m/48'/0'/0'/2'") // => "48h/0h/0h/2h"
 * formatPathForDescriptor("84'/0'/0'") // => "84h/0h/0h"
 */
export function formatPathForDescriptor(path: string): string {
  // Remove m/ prefix and replace ' with h
  return path.replace(/^m\//, "").replace(/'/g, "h");
}

/**
 * Extract the change index and address index from a derivation path.
 * For BIP-48 multisig: purpose'/coin'/account'/script'/change/index
 * The last two non-hardened parts are change and index.
 *
 * @example
 * extractChangeAndAddressIndex("m/48'/0'/0'/2'/0/5") // => { changeIdx: 0, addressIdx: 5 }
 * extractChangeAndAddressIndex("m/84'/0'/0'/1/10") // => { changeIdx: 1, addressIdx: 10 }
 */
export function extractChangeAndAddressIndex(derivationPath: string): {
  changeIdx: number;
  addressIdx: number;
} {
  const parsed = parseDerivationPath(derivationPath);
  if (!parsed.valid) {
    throw new Error("Invalid derivation path");
  }

  return {
    changeIdx: parsed.changeIndex ?? 0,
    addressIdx: parsed.addressIndex ?? 0,
  };
}
