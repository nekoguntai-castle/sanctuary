/**
 * Descriptor Parser Types
 *
 * Shared interfaces and type definitions for the descriptor parser module.
 */

export interface ParsedDevice {
  fingerprint: string;
  xpub: string;
  derivationPath: string;
}

export type ScriptType = 'native_segwit' | 'nested_segwit' | 'taproot' | 'legacy';
export type Network = 'mainnet' | 'testnet' | 'regtest';

export interface ParsedDescriptor {
  type: 'single_sig' | 'multi_sig';
  scriptType: ScriptType;
  devices: ParsedDevice[];
  quorum?: number;
  totalSigners?: number;
  network: Network;
  isChange: boolean;
}

export interface DescriptorParseError {
  message: string;
  position?: number;
}

/**
 * JSON import format interface
 */
export interface JsonImportDevice {
  type?: string;
  label?: string;
  fingerprint: string;
  derivationPath: string;
  xpub: string;
}

export interface JsonImportConfig {
  type: 'single_sig' | 'multi_sig';
  scriptType: ScriptType;
  quorum?: number;
  network?: Network;
  devices: JsonImportDevice[];
  name?: string;
}

/**
 * Wallet export format (from Sparrow, Specter, etc.)
 * Contains a descriptor string inside JSON
 */
export interface WalletExportFormat {
  label?: string;
  name?: string;
  descriptor: string;
  blockheight?: number;
}

/**
 * Coldcard JSON export format
 * Contains xfp (fingerprint) and multiple derivation paths (bip44, bip49, bip84, bip48)
 *
 * Two export formats exist:
 * 1. Nested format (standard single-sig export): bip44/bip49/bip84/bip48_1/bip48_2 objects
 * 2. Flat format (generic multisig export): p2sh/p2sh_p2wsh/p2wsh with separate _deriv keys
 */
export interface ColdcardJsonExport {
  chain?: string;
  xfp: string;
  xpub?: string;
  account?: number | string;
  // Nested format (standard export)
  bip44?: {
    xpub: string;
    deriv: string;
    name?: string;
    first?: string;
  };
  bip49?: {
    xpub: string;
    deriv: string;
    name?: string;
    first?: string;
    _pub?: string;
  };
  bip84?: {
    xpub: string;
    deriv: string;
    name?: string;
    first?: string;
    _pub?: string;
  };
  bip48_1?: {
    xpub: string;
    deriv: string;
    name?: string;
  };
  bip48_2?: {
    xpub: string;
    deriv: string;
    name?: string;
  };
  // Flat format (generic multisig export from Coldcard)
  p2sh?: string;        // Legacy multisig xpub
  p2sh_deriv?: string;  // e.g., "m/45'"
  p2sh_p2wsh?: string;  // Nested segwit multisig Ypub
  p2sh_p2wsh_deriv?: string; // e.g., "m/48'/0'/0'/1'"
  p2wsh?: string;       // Native segwit multisig Zpub
  p2wsh_deriv?: string; // e.g., "m/48'/0'/0'/2'"
}

/**
 * BlueWallet multisig text format parser
 *
 * Format example:
 * # BlueWallet Multisig setup file
 * Name: MyWallet
 * Policy: 2 of 3
 * Derivation: m/48'/0'/0'/2'
 * Format: P2WSH
 *
 * # derivation: m/48'/0'/0'/2'
 * 7E839592: xpub6EGS...
 */
export interface BlueWalletTextFormat {
  name?: string;
  policy?: { quorum: number; total: number };
  derivation?: string;
  format?: string;
  devices: Array<{
    fingerprint: string;
    xpub: string;
    derivationPath?: string;
  }>;
}
