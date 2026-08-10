/**
 * Descriptor Builder Service
 *
 * Generates Bitcoin output descriptors from device xpubs and derivation paths
 * Supports both single-sig and multi-sig descriptor formats
 */

interface DeviceInfo {
  fingerprint: string;
  xpub: string;
  derivationPath?: string;
}

import { formatPathForDescriptor } from '@sanctuary/shared/utils/bitcoin';
import {
  isNetworkType,
  type LegacyNetworkType,
  type NetworkType,
} from '@sanctuary/shared/constants/bitcoin';
import {
  WalletScriptType,
  WalletType,
  type WalletScriptType as ScriptType,
  type WalletType as WalletTypeValue,
} from '@sanctuary/shared/constants/walletIdentity';
import {
  buildCanonicalAccountPath,
  findWalletPolicy,
  renderDescriptorWrapper,
} from '@sanctuary/shared/constants/walletPolicy';
import {
  parseCanonicalDescriptor,
  renderCanonicalDescriptor,
  replaceCanonicalDescriptorBranch,
} from './descriptorParser';

type Network = LegacyNetworkType;

function wrapPolicyDescriptor(
  walletType: WalletTypeValue,
  scriptType: ScriptType,
  expression: string,
): string {
  // Public builders validate supported wallet/script combinations first.
  const policy = findWalletPolicy(walletType, scriptType)!;
  return renderDescriptorWrapper(policy.descriptorWrapper, expression);
}

function canonicalNetwork(network: Network): NetworkType {
  if (network === 'testnet') return 'testnet3';
  if (!isNetworkType(network)) throw new Error(`Unknown Bitcoin network: ${network}`);
  return network;
}

function canonicalAccountPath(
  walletType: WalletTypeValue,
  scriptType: ScriptType,
  network: Network,
  account: number,
): string {
  try {
    return buildCanonicalAccountPath({
      walletType,
      scriptType,
      chainEnvironment: canonicalNetwork(network),
      account,
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unsupported wallet policy') {
      throw new Error(`Unknown script type: ${scriptType}`);
    }
    throw error;
  }
}

const validateAndRenderDescriptor = (descriptor: string): string =>
  renderCanonicalDescriptor(parseCanonicalDescriptor(descriptor));

/**
 * Get the standard BIP derivation path for a script type
 */
export function getDerivationPath(
  scriptType: ScriptType,
  network: Network = 'mainnet',
  account: number = 0
): string {
  return canonicalAccountPath(WalletType.SINGLE_SIG, scriptType, network, account);
}

/**
 * Get the standard BIP derivation path for multisig
 */
export function getMultisigDerivationPath(
  scriptType: ScriptType,
  network: Network = 'mainnet',
  account: number = 0
): string {
  // This safety program supports only BIP48 nested/native sorted multisig.
  // Legacy P2SH and Taproot multisig remain blocked until independently proven.
  if (scriptType === WalletScriptType.LEGACY || scriptType === WalletScriptType.TAPROOT) {
    throw new Error(`Unsupported multi-sig script type: ${scriptType}`);
  }
  return canonicalAccountPath(WalletType.MULTI_SIG, scriptType, network, account);
}


/**
 * Build a single-sig descriptor from device info
 */
export function buildSingleSigDescriptor(
  device: DeviceInfo,
  scriptType: ScriptType,
  network: Network = 'mainnet'
): string {
  if (!Object.values(WalletScriptType).includes(scriptType)) {
    throw new Error(`Unsupported script type: ${scriptType}`);
  }
  const derivationPath = device.derivationPath || getDerivationPath(scriptType, network);
  const formattedPath = formatPathForDescriptor(derivationPath);

  // Build key expression: [fingerprint/path]xpub
  const keyExpression = `[${device.fingerprint}/${formattedPath}]${device.xpub}`;

  return validateAndRenderDescriptor(
    wrapPolicyDescriptor(WalletType.SINGLE_SIG, scriptType, `${keyExpression}/0/*`),
  );
}

/**
 * Build a multi-sig descriptor from multiple devices
 * Returns sorted multi (sortedmulti) descriptor for deterministic ordering
 */
export function buildMultiSigDescriptor(
  devices: DeviceInfo[],
  quorum: number,
  scriptType: ScriptType,
  network: Network = 'mainnet'
): string {
  if (!Object.values(WalletScriptType).includes(scriptType)) {
    throw new Error(`Unsupported script type: ${scriptType}`);
  }
  if (scriptType !== WalletScriptType.NESTED_SEGWIT
    && scriptType !== WalletScriptType.NATIVE_SEGWIT) {
    throw new Error(`Unsupported multi-sig script type: ${scriptType}`);
  }
  if (devices.length < 2) {
    throw new Error('Multi-sig requires at least 2 devices');
  }

  if (quorum > devices.length) {
    throw new Error('Quorum cannot exceed total number of signers');
  }

  if (quorum < 1) {
    throw new Error('Quorum must be at least 1');
  }

  // Build key expressions for each device
  const keyExpressions = devices.map((device) => {
    const derivationPath = device.derivationPath || getMultisigDerivationPath(scriptType, network);
    const formattedPath = formatPathForDescriptor(derivationPath);
    return `[${device.fingerprint}/${formattedPath}]${device.xpub}/0/*`;
  });

  // Use sortedmulti for deterministic key ordering
  const sortedMulti = `sortedmulti(${quorum},${keyExpressions.join(',')})`;

  return validateAndRenderDescriptor(
    wrapPolicyDescriptor(WalletType.MULTI_SIG, scriptType, sortedMulti),
  );
}

/**
 * Build change descriptor (internal chain) from receive descriptor
 */
export function buildChangeDescriptor(receiveDescriptor: string): string {
  return replaceCanonicalDescriptorBranch(receiveDescriptor, 0, 1);
}

/**
 * Build descriptor from wallet creation request
 */
export function buildDescriptorFromDevices(
  devices: DeviceInfo[],
  options: {
    type: WalletTypeValue;
    scriptType: ScriptType;
    network?: Network;
    quorum?: number;
  }
): {
  descriptor: string;
  changeDescriptor: string;
  fingerprint: string;
} {
  const { type, scriptType, network = 'mainnet', quorum } = options;

  let descriptor: string;
  let fingerprint: string;

  if (type === WalletType.SINGLE_SIG) {
    if (devices.length !== 1) {
      throw new Error('Single-sig wallet requires exactly 1 device');
    }

    descriptor = buildSingleSigDescriptor(devices[0], scriptType, network);
    fingerprint = devices[0].fingerprint;
  } else {
    if (!quorum) {
      throw new Error('Quorum is required for multi-sig wallets');
    }

    descriptor = buildMultiSigDescriptor(devices, quorum, scriptType, network);
    // For multi-sig, use first device fingerprint as wallet identifier
    fingerprint = devices.map(d => d.fingerprint).join('-');
  }

  const changeDescriptor = buildChangeDescriptor(descriptor);

  return {
    descriptor,
    changeDescriptor,
    fingerprint,
  };
}

/**
 * Validate that a device supports the requested script type
 */
export function validateDeviceScriptType(
  deviceScriptTypes: string[],
  requestedScriptType: ScriptType
): boolean {
  // Map our internal script type names to common variations
  const scriptTypeMap: Record<ScriptType, string[]> = {
    [WalletScriptType.NATIVE_SEGWIT]: [WalletScriptType.NATIVE_SEGWIT, 'p2wpkh', 'bech32', 'segwit'],
    [WalletScriptType.NESTED_SEGWIT]: [WalletScriptType.NESTED_SEGWIT, 'p2sh-p2wpkh', 'wrapped_segwit', 'segwit'],
    [WalletScriptType.TAPROOT]: [WalletScriptType.TAPROOT, 'p2tr', 'bech32m'],
    [WalletScriptType.LEGACY]: [WalletScriptType.LEGACY, 'p2pkh'],
  };

  const validTypes = scriptTypeMap[requestedScriptType] || [];

  return deviceScriptTypes.some(
    (type) =>
      validTypes.includes(type.toLowerCase()) ||
      type.toLowerCase() === requestedScriptType.toLowerCase()
  );
}
