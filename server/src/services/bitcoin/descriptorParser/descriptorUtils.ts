/**
 * Descriptor Utilities
 *
 * Low-level utility functions for parsing Bitcoin output descriptors:
 * network detection, key expression parsing, script type detection, etc.
 */

import { normalizeDerivationPath } from '../../../../../shared/utils/bitcoin';
import type { ParsedDevice, ScriptType, Network } from './types';

/**
 * Detect network from xpub prefix or derivation path
 */
export function detectNetwork(xpub: string, derivationPath: string): Network {
  // Check derivation path coin type
  const coinTypeMatch = derivationPath.match(/\/(\d+)[h']/);
  if (coinTypeMatch) {
    const coinType = coinTypeMatch[1];
    if (coinType === '1') return 'testnet';
  }

  // Check xpub prefix for testnet/regtest
  if (xpub.startsWith('tpub') || xpub.startsWith('upub') || xpub.startsWith('vpub')) {
    return 'testnet';
  }

  return 'mainnet';
}

/**
 * Parse a key expression like [fingerprint/path]xpub/chain/*
 * Returns device info with fingerprint, xpub, and derivation path
 */
export function parseKeyExpression(keyExpr: string): ParsedDevice {
  // Match [fingerprint/path]xpub pattern
  // Fingerprint is 8 hex chars, path can use ' or h for hardened
  const keyMatch = keyExpr.match(
    /\[([a-fA-F0-9]{8})\/([^\]]+)\]([xyztuvYZTUVpub][a-zA-Z0-9]+)/
  );

  if (!keyMatch) {
    throw new Error('Invalid descriptor key expression');
  }

  const [, fingerprint, pathPart, xpub] = keyMatch;
  const derivationPath = normalizeDerivationPath(pathPart);

  return {
    fingerprint: fingerprint.toLowerCase(),
    xpub,
    derivationPath,
  };
}

/**
 * Extract all key expressions from a descriptor
 */
export function extractKeyExpressions(descriptor: string): string[] {
  const expressions: string[] = [];

  // Find all [fingerprint/path]xpub patterns
  const regex = /\[[a-fA-F0-9]{8}\/[^\]]+\][xyztuvYZTUVpub][a-zA-Z0-9]+(?:\/[\d*]+)*/g;
  let match;

  while ((match = regex.exec(descriptor)) !== null) {
    expressions.push(match[0]);
  }

  return expressions;
}

/**
 * Detect if descriptor represents a change (internal) chain
 */
export function isChangeDescriptor(descriptor: string): boolean {
  // Look for /1/* pattern which indicates internal/change chain
  return /\/1\/\*/.test(descriptor);
}

/**
 * Detect script type from descriptor wrapper functions
 */
export function detectScriptType(descriptor: string): ScriptType {
  const trimmed = descriptor.trim().toLowerCase();

  if (trimmed.startsWith('sh(wsh(sortedmulti')) {
    return 'nested_segwit'; // P2SH-P2WSH multisig
  }
  if (trimmed.startsWith('wsh(sortedmulti') || trimmed.startsWith('wsh(multi')) {
    return 'native_segwit'; // P2WSH multisig
  }
  if (trimmed.startsWith('sh(sortedmulti') || trimmed.startsWith('sh(multi')) {
    return 'legacy'; // P2SH multisig
  }
  if (trimmed.startsWith('sh(wpkh(')) {
    return 'nested_segwit'; // P2SH-P2WPKH
  }
  if (trimmed.startsWith('wpkh(')) {
    return 'native_segwit'; // P2WPKH
  }
  if (trimmed.startsWith('tr(')) {
    return 'taproot'; // P2TR
  }
  if (trimmed.startsWith('pkh(')) {
    return 'legacy'; // P2PKH
  }

  throw new Error('Unable to detect script type from descriptor');
}

/**
 * Detect if descriptor is multisig
 */
export function isMultisigDescriptor(descriptor: string): boolean {
  const lower = descriptor.toLowerCase();
  return lower.includes('sortedmulti(') || lower.includes('multi(');
}

/**
 * Extract quorum from multisig descriptor
 * sortedmulti(M, key1, key2, ...) where M is quorum
 */
export function extractQuorum(descriptor: string): number {
  const match = descriptor.match(/(?:sorted)?multi\((\d+)/i);
  if (!match) {
    throw new Error('Could not extract quorum from multisig descriptor');
  }
  return parseInt(match[1], 10);
}
