/**
 * BlueWallet Text Format Parser
 *
 * Parses BlueWallet/Coldcard multisig text export format into standard ParsedDescriptor.
 */

import { normalizeDerivationPath } from '../../../../../shared/utils/bitcoin';
import { detectNetwork } from './descriptorUtils';
import type { ParsedDevice, ParsedDescriptor, ScriptType, BlueWalletTextFormat } from './types';

/**
 * Check if input looks like BlueWallet text format
 */
export function isBlueWalletTextFormat(input: string): boolean {
  const lines = input.split('\n');
  let hasPolicy = false;
  let hasDeviceLine = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.match(/^Policy:\s*\d+\s+of\s+\d+$/i)) {
      hasPolicy = true;
    }
    // Device line: fingerprint: xpub (8 hex chars followed by colon and xpub)
    if (trimmed.match(/^[a-fA-F0-9]{8}:\s*[xyztuvYZTUVpub]/)) {
      hasDeviceLine = true;
    }
  }

  return hasPolicy && hasDeviceLine;
}

/**
 * Parse BlueWallet text format
 */
export function parseBlueWalletText(input: string): BlueWalletTextFormat {
  const lines = input.split('\n');
  const result: BlueWalletTextFormat = {
    devices: [],
  };

  let currentDerivation: string | undefined;

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip empty lines
    if (!trimmed) continue;

    // Parse Name: value
    const nameMatch = trimmed.match(/^Name:\s*(.+)$/i);
    if (nameMatch) {
      result.name = nameMatch[1].trim();
      continue;
    }

    // Parse Policy: M of N
    const policyMatch = trimmed.match(/^Policy:\s*(\d+)\s+of\s+(\d+)$/i);
    if (policyMatch) {
      result.policy = {
        quorum: parseInt(policyMatch[1], 10),
        total: parseInt(policyMatch[2], 10),
      };
      continue;
    }

    // Parse Derivation: m/48'/0'/0'/2'
    const derivationMatch = trimmed.match(/^Derivation:\s*(.+)$/i);
    if (derivationMatch) {
      result.derivation = derivationMatch[1].trim();
      continue;
    }

    // Parse Format: P2WSH
    const formatMatch = trimmed.match(/^Format:\s*(.+)$/i);
    if (formatMatch) {
      result.format = formatMatch[1].trim().toUpperCase();
      continue;
    }

    // Parse comment with derivation path: # derivation: m/48'/0'/0'/2'
    const commentDerivationMatch = trimmed.match(/^#\s*derivation:\s*(.+)$/i);
    if (commentDerivationMatch) {
      currentDerivation = commentDerivationMatch[1].trim();
      continue;
    }

    // Skip other comments
    if (trimmed.startsWith('#')) continue;

    // Parse device line: fingerprint: xpub
    const deviceMatch = trimmed.match(/^([a-fA-F0-9]{8}):\s*([xyztuvYZTUVpub][a-zA-Z0-9]+)$/);
    if (deviceMatch) {
      result.devices.push({
        fingerprint: deviceMatch[1].toLowerCase(),
        xpub: deviceMatch[2],
        derivationPath: currentDerivation || result.derivation,
      });
      currentDerivation = undefined; // Reset for next device
      continue;
    }
  }

  return result;
}

/**
 * Convert BlueWallet format string to script type
 */
function blueWalletFormatToScriptType(format: string | undefined): ScriptType {
  if (!format) return 'native_segwit';

  const upper = format.toUpperCase();
  switch (upper) {
    case 'P2WSH':
      return 'native_segwit';
    case 'P2SH-P2WSH':
    case 'P2WSH-P2SH': // Coldcard uses inner-outer notation (P2WSH wrapped in P2SH)
      return 'nested_segwit';
    case 'P2SH':
      return 'legacy';
    case 'P2TR':
      return 'taproot';
    case 'P2SH-P2TR':
    case 'P2TR-P2SH': // Nested taproot (rare but possible)
      return 'taproot'; // Note: Actually nested, but we map to taproot as closest match
    case 'P2WPKH':
      return 'native_segwit';
    case 'P2SH-P2WPKH':
    case 'P2WPKH-P2SH': // Coldcard uses inner-outer notation
      return 'nested_segwit';
    case 'P2PKH':
      return 'legacy';
    default:
      return 'native_segwit';
  }
}

/**
 * Parse BlueWallet text format into standard ParsedDescriptor
 */
export function parseBlueWalletTextImport(input: string): ParsedDescriptor {
  const parsed = parseBlueWalletText(input);

  if (parsed.devices.length === 0) {
    throw new Error('No devices found in BlueWallet text file');
  }

  // Map devices to standard format
  const devices: ParsedDevice[] = parsed.devices.map((d) => ({
    fingerprint: d.fingerprint,
    xpub: d.xpub,
    derivationPath: normalizeDerivationPath(d.derivationPath || parsed.derivation || "m/48'/0'/0'/2'"),
  }));

  // Detect network from first device
  const network = detectNetwork(devices[0].xpub, devices[0].derivationPath);

  // Determine wallet type
  const isMultisig = parsed.policy && parsed.policy.total > 1;

  const result: ParsedDescriptor = {
    type: isMultisig ? 'multi_sig' : 'single_sig',
    scriptType: blueWalletFormatToScriptType(parsed.format),
    devices,
    network,
    isChange: false,
  };

  if (isMultisig && parsed.policy) {
    result.quorum = parsed.policy.quorum;
    result.totalSigners = parsed.policy.total;
  }

  return result;
}
