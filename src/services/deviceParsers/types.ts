/**
 * Device Parser Types
 *
 * Defines interfaces for the pluggable device import format system.
 * New import formats can be added by implementing DeviceParser interface.
 */

import type {
  DeviceAccountPurpose,
  WalletScriptType,
} from '@sanctuary/shared/constants/walletIdentity';

/**
 * A single account from a hardware wallet device
 * Represents one xpub at a specific derivation path
 */
export interface DeviceAccount {
  /** Extended public key (xpub, ypub, zpub, etc.) */
  xpub: string;
  /** BIP32 derivation path (e.g., "m/84'/0'/0'") */
  derivationPath: string;
  /** Purpose: single-sig or multisig */
  purpose: DeviceAccountPurpose;
  /** Script type for this account */
  scriptType: WalletScriptType;
}

/**
 * Result of parsing device data from various formats
 */
export interface DeviceParseResult {
  /** Extended public key (xpub, ypub, zpub, etc.) - primary/preferred account */
  xpub?: string;
  /** Master fingerprint (8 hex characters) */
  fingerprint?: string;
  /** BIP32 derivation path (e.g., "m/84'/0'/0'") - primary/preferred account */
  derivationPath?: string;
  /** Optional label/name for the device */
  label?: string;
  /** All available accounts from the device (for multi-account import) */
  accounts?: DeviceAccount[];
}

/**
 * Result of format detection
 */
export interface FormatDetectionResult {
  /** Whether this parser can handle the input */
  detected: boolean;
  /** Confidence level 0-100, higher = more confident */
  confidence: number;
}

/**
 * Device Parser interface
 *
 * Implement this interface to add support for a new device import format.
 * Register the parser with deviceParserRegistry.register()
 */
export interface DeviceParser {
  /** Unique identifier for this format */
  readonly id: string;

  /** Human-readable name */
  readonly name: string;

  /** Description of what this format supports */
  readonly description: string;

  /**
   * Priority for format detection (higher = checked first)
   * Use 90+ for specific formats, 50-89 for generic, 10-49 for fallbacks
   */
  readonly priority: number;

  /**
   * Check if this parser can process the input
   * Should be fast and not throw errors
   * @param data Parsed JSON object or raw string
   */
  canParse(data: unknown): FormatDetectionResult;

  /**
   * Parse the input into device fields
   * Only called if canParse() returned detected: true
   * @param data Parsed JSON object or raw string
   */
  parse(data: unknown): DeviceParseResult;
}

/**
 * Registry configuration
 */
export interface DeviceParserRegistryConfig {
  /** Enable debug logging */
  debug?: boolean;
}
