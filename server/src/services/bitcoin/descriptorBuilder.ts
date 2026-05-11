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

type ScriptType = 'native_segwit' | 'nested_segwit' | 'taproot' | 'legacy';
type Network = 'mainnet' | 'testnet3' | 'testnet4' | 'signet' | 'regtest';

/**
 * Get the standard BIP derivation path for a script type
 */
export function getDerivationPath(
  scriptType: ScriptType,
  network: Network = 'mainnet',
  account: number = 0
): string {
  const coinType = network === 'mainnet' ? '0' : '1';

  switch (scriptType) {
    case 'legacy':
      return `m/44'/${coinType}'/${account}'`;
    case 'nested_segwit':
      return `m/49'/${coinType}'/${account}'`;
    case 'native_segwit':
      return `m/84'/${coinType}'/${account}'`;
    case 'taproot':
      return `m/86'/${coinType}'/${account}'`;
    default:
      throw new Error(`Unknown script type: ${scriptType}`);
  }
}

/**
 * Get the standard BIP derivation path for multisig
 */
export function getMultisigDerivationPath(
  scriptType: ScriptType,
  network: Network = 'mainnet',
  account: number = 0
): string {
  const coinType = network === 'mainnet' ? '0' : '1';

  switch (scriptType) {
    case 'legacy':
      return `m/45'/${account}'`; // BIP45 for legacy multisig
    case 'nested_segwit':
      return `m/48'/${coinType}'/${account}'/1'`; // BIP48 script type 1
    case 'native_segwit':
      return `m/48'/${coinType}'/${account}'/2'`; // BIP48 script type 2
    case 'taproot':
      return `m/48'/${coinType}'/${account}'/3'`; // BIP48 script type 3 (proposed)
    default:
      throw new Error(`Unknown script type: ${scriptType}`);
  }
}


/**
 * Build a single-sig descriptor from device info
 */
export function buildSingleSigDescriptor(
  device: DeviceInfo,
  scriptType: ScriptType,
  network: Network = 'mainnet'
): string {
  const derivationPath = device.derivationPath || getDerivationPath(scriptType, network);
  const formattedPath = formatPathForDescriptor(derivationPath);

  // Build key expression: [fingerprint/path]xpub
  const keyExpression = `[${device.fingerprint}/${formattedPath}]${device.xpub}`;

  // Build descriptor based on script type
  switch (scriptType) {
    case 'legacy':
      // P2PKH: pkh([fp/44h/0h/0h]xpub/0/*)
      return `pkh(${keyExpression}/0/*)`;

    case 'nested_segwit':
      // P2SH-P2WPKH: sh(wpkh([fp/49h/0h/0h]xpub/0/*))
      return `sh(wpkh(${keyExpression}/0/*))`;

    case 'native_segwit':
      // P2WPKH: wpkh([fp/84h/0h/0h]xpub/0/*)
      return `wpkh(${keyExpression}/0/*)`;

    case 'taproot':
      // P2TR: tr([fp/86h/0h/0h]xpub/0/*)
      return `tr(${keyExpression}/0/*)`;

    default:
      throw new Error(`Unsupported script type: ${scriptType}`);
  }
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

  // Wrap in appropriate script type
  switch (scriptType) {
    case 'legacy':
      // P2SH multisig: sh(sortedmulti(m, key1, key2, ...))
      return `sh(${sortedMulti})`;

    case 'nested_segwit':
      // P2SH-P2WSH multisig: sh(wsh(sortedmulti(m, key1, key2, ...)))
      return `sh(wsh(${sortedMulti}))`;

    case 'native_segwit':
      // P2WSH multisig: wsh(sortedmulti(m, key1, key2, ...))
      return `wsh(${sortedMulti})`;

    case 'taproot':
      // Taproot multisig uses different mechanism (MuSig2 or threshold tree)
      // For now, use basic multi-key taproot (not fully standard yet)
      throw new Error('Taproot multisig is not yet supported');

    default:
      throw new Error(`Unsupported script type: ${scriptType}`);
  }
}

/**
 * Build change descriptor (internal chain) from receive descriptor
 */
export function buildChangeDescriptor(receiveDescriptor: string): string {
  // Replace /0/* (external chain) with /1/* (internal chain)
  return receiveDescriptor.replace(/\/0\/\*\)/g, '/1/*)');
}

/**
 * Build descriptor from wallet creation request
 */
export function buildDescriptorFromDevices(
  devices: DeviceInfo[],
  options: {
    type: 'single_sig' | 'multi_sig';
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

  if (type === 'single_sig') {
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
    native_segwit: ['native_segwit', 'p2wpkh', 'bech32', 'segwit'],
    nested_segwit: ['nested_segwit', 'p2sh-p2wpkh', 'wrapped_segwit', 'segwit'],
    taproot: ['taproot', 'p2tr', 'bech32m'],
    legacy: ['legacy', 'p2pkh'],
  };

  const validTypes = scriptTypeMap[requestedScriptType] || [];

  return deviceScriptTypes.some(
    (type) =>
      validTypes.includes(type.toLowerCase()) ||
      type.toLowerCase() === requestedScriptType.toLowerCase()
  );
}
