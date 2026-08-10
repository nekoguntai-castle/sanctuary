/**
 * BlueWallet Text Format Parser
 *
 * Parses BlueWallet/Coldcard multisig text export format into standard ParsedDescriptor.
 */

import { normalizeDerivationPath } from '@sanctuary/shared/utils/bitcoin';
import {
  accountPathMatchesWalletPolicy,
  type DerivationNetworkFamily,
} from '@sanctuary/shared/constants/walletPolicy';
import { WalletScriptType, WalletType } from '@sanctuary/shared/constants/walletIdentity';
import { validateParsedDescriptorDomain } from './domainValidation';
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

    const sortedMatch = trimmed.match(/^Sorted:\s*(true|false)$/i);
    if (sortedMatch) {
      result.sorted = sortedMatch[1].toLowerCase() === 'true';
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
function blueWalletFormatToScriptType(format: string | undefined, isMultisig: boolean): ScriptType {
  if (!format) throw new Error('BlueWallet import requires an explicit Format field');

  const supportedFormats: Record<string, ScriptType> = isMultisig
    ? {
      P2WSH: WalletScriptType.NATIVE_SEGWIT,
      'P2SH-P2WSH': WalletScriptType.NESTED_SEGWIT,
      'P2WSH-P2SH': WalletScriptType.NESTED_SEGWIT,
    }
    : {
      P2PKH: WalletScriptType.LEGACY,
      P2WPKH: WalletScriptType.NATIVE_SEGWIT,
      'P2SH-P2WPKH': WalletScriptType.NESTED_SEGWIT,
      'P2WPKH-P2SH': WalletScriptType.NESTED_SEGWIT,
      P2TR: WalletScriptType.TAPROOT,
    };
  const scriptType = supportedFormats[format.toUpperCase()];
  if (!scriptType) throw new Error(`Unsupported BlueWallet Format: ${format}`);
  return scriptType;
}

const networkFamily = (network: ParsedDescriptor['network']): DerivationNetworkFamily =>
  network === 'mainnet' ? 'mainnet' : 'testnet';

function assertExactDeviceSet(
  parsed: BlueWalletTextFormat,
): NonNullable<BlueWalletTextFormat['policy']> {
  if (!parsed.policy) throw new Error('BlueWallet import requires an explicit Policy field');
  if (parsed.policy.quorum < 1 || parsed.policy.quorum > parsed.policy.total) {
    throw new Error('BlueWallet Policy quorum must be within the declared signer count');
  }
  if (parsed.policy.total !== parsed.devices.length) {
    throw new Error('BlueWallet Policy signer count must equal the number of device rows');
  }
  const fingerprints = new Set(parsed.devices.map(device => device.fingerprint));
  const xpubs = new Set(parsed.devices.map(device => device.xpub));
  if (fingerprints.size !== parsed.devices.length || xpubs.size !== parsed.devices.length) {
    throw new Error('BlueWallet import requires unique fingerprint and extended-key rows');
  }
  return parsed.policy;
}

function assertCanonicalDevicePaths(parsed: ParsedDescriptor): void {
  const family = networkFamily(parsed.network);
  for (const device of parsed.devices) {
    if (!accountPathMatchesWalletPolicy(device.derivationPath, {
      walletType: parsed.type,
      scriptType: parsed.scriptType,
      derivationFamily: family,
    })) {
      throw new Error('BlueWallet derivation path does not match the declared wallet policy');
    }
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

  const policy = assertExactDeviceSet(parsed);
  const isMultisig = policy.total > 1;
  if (isMultisig && parsed.sorted !== true) {
    throw new Error('BlueWallet multisig import requires Sorted: true');
  }

  // Map devices to standard format
  const devices: ParsedDevice[] = parsed.devices.map((d) => ({
    fingerprint: d.fingerprint,
    xpub: d.xpub,
    derivationPath: normalizeDerivationPath(d.derivationPath || parsed.derivation),
  }));

  // Detect network from first device
  const network = detectNetwork(devices[0].xpub, devices[0].derivationPath);

  const result: ParsedDescriptor = {
    type: isMultisig ? WalletType.MULTI_SIG : WalletType.SINGLE_SIG,
    scriptType: blueWalletFormatToScriptType(parsed.format, isMultisig),
    devices,
    network,
    isChange: false,
  };

  if (isMultisig) {
    result.quorum = policy.quorum;
    result.totalSigners = policy.total;
  }

  assertCanonicalDevicePaths(result);
  validateParsedDescriptorDomain(result);
  return result;
}
