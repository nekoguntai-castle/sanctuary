/**
 * Descriptor-Based Address Derivation
 *
 * High-level functions that derive addresses from output descriptors,
 * routing to single-sig or multisig derivation as appropriate.
 */

import * as bitcoin from 'bitcoinjs-lib';
import * as ecc from 'tiny-secp256k1';
import {
  parseCanonicalAccountPath,
  type DescriptorWrapper,
} from '@sanctuary/shared/constants/walletPolicy';
import {
  WalletScriptType,
  type WalletScriptType as WalletScriptTypeValue,
} from '@sanctuary/shared/constants/walletIdentity';
import bip32 from '../bip32';
import { parseDescriptor } from './descriptorParser';
import { deriveAddress } from './singleSigDerivation';
import { deriveMultisigAddress } from './multisigDerivation';
import { getNetwork } from './utils';
import { convertToStandardXpub } from './xpubConversion';
import type {
  AddressDerivationNetwork,
  CanonicalDerivedAddress,
  CanonicalSignerOrigin,
  ParsedDescriptor,
  DescriptorDerivationDeps,
  DerivedAddress,
} from './types';

// Initialize ECC library for Taproot/Schnorr support
bitcoin.initEccLib(ecc);

const MAX_UNHARDENED_INDEX = 0x7fffffff;
const HARDENED_INDEX_OFFSET = 0x80000000;

const normalizeAccountPath = (path: string): string => {
  const normalized = path.replace(/h/gi, "'");
  return normalized.startsWith('m/') ? normalized : `m/${normalized}`;
};

const canonicalFingerprint = (fingerprint: string): string => {
  const normalized = fingerprint.toLowerCase();
  if (!/^[0-9a-f]{8}$/.test(normalized) || normalized === '00000000') {
    throw new Error('Canonical descriptor requires a nonzero signer fingerprint');
  }
  return normalized;
};

function assertCanonicalCoordinate(branch: number, index: number): asserts branch is 0 | 1 {
  if ((branch !== 0 && branch !== 1)
    || !Number.isInteger(index)
    || index < 0
    || index > MAX_UNHARDENED_INDEX) {
    throw new Error('Invalid canonical address coordinate');
  }
}

const assertDescriptorBranch = (parsed: ParsedDescriptor, branch: 0 | 1): void => {
  const paths = parsed.keys?.map(({ derivationPath }) => derivationPath)
    ?? (parsed.path ? [parsed.path] : []);
  if (paths.length === 0) {
    throw new Error('Canonical descriptor must contain an explicit branch wildcard');
  }
  for (const path of paths) {
    const match = /^(0|1)\/\*$/.exec(path);
    if (!match) {
      throw new Error(`Unsupported canonical descriptor suffix: ${path}`);
    }
    const descriptorBranch = Number(match[1]);
    if (descriptorBranch !== branch) {
      throw new Error(
        `descriptor branch ${descriptorBranch} does not match coordinate branch ${branch}`
      );
    }
  }
};

const singleSigOrigins = (
  parsed: ParsedDescriptor,
  branch: 0 | 1,
  index: number
): CanonicalSignerOrigin[] => {
  if (!parsed.fingerprint || !parsed.accountPath) {
    throw new Error('Canonical descriptor requires signer fingerprint and account origin');
  }
  return [{
    fingerprint: canonicalFingerprint(parsed.fingerprint),
    accountPath: normalizeAccountPath(parsed.accountPath),
    branch,
    index,
  }];
};

const canonicalSignerOrigins = (
  parsed: ParsedDescriptor,
  branch: 0 | 1,
  index: number
): CanonicalSignerOrigin[] => {
  if (!parsed.keys) {
    return singleSigOrigins(parsed, branch, index);
  }
  return parsed.keys.map(({ fingerprint, accountPath }) => {
    if (!accountPath) {
      throw new Error('Canonical descriptor requires an account origin for every signer');
    }
    return {
      fingerprint: canonicalFingerprint(fingerprint),
      accountPath: normalizeAccountPath(accountPath),
      branch,
      index,
    };
  });
};

interface ExtendedKeyOrigin {
  xpub: string;
  accountPath: string;
}

const DESCRIPTOR_WRAPPER_BY_TYPE: Record<ParsedDescriptor['type'], DescriptorWrapper> = {
  pkh: 'pkh',
  'sh-wpkh': 'sh(wpkh)',
  wpkh: 'wpkh',
  tr: 'tr',
  'sh-wsh-sortedmulti': 'sh(wsh(sortedmulti))',
  'wsh-sortedmulti': 'wsh(sortedmulti)',
};

function descriptorExtendedKeyOrigins(parsed: ParsedDescriptor): ExtendedKeyOrigin[] {
  if (parsed.keys) {
    // canonicalSignerOrigins has already required every multisig account path.
    return parsed.keys.map(({ xpub, accountPath }) => ({ xpub, accountPath: accountPath! }));
  }
  // singleSigOrigins has already required both values.
  return [{ xpub: parsed.xpub!, accountPath: parsed.accountPath! }];
}

function assertExtendedKeyOriginBinding(
  origin: ExtendedKeyOrigin,
  network: AddressDerivationNetwork,
  descriptorType: ParsedDescriptor['type'],
): void {
  const accountPath = normalizeAccountPath(origin.accountPath);
  const parsedPath = parseCanonicalAccountPath(accountPath);
  if (!parsedPath) {
    throw new Error('Canonical descriptor account origin is not an allowed account path');
  }
  if (parsedPath.policy.descriptorWrapper !== DESCRIPTOR_WRAPPER_BY_TYPE[descriptorType]) {
    throw new Error('Canonical descriptor wrapper does not match account origin policy');
  }
  const networkFamily = network === 'mainnet' ? 'mainnet' : 'testnet';
  if (parsedPath.derivationFamily !== networkFamily) {
    throw new Error('Canonical descriptor account origin coin type does not match wallet network');
  }
  // The serialized xpub must itself be the key named by the origin. Checking
  // depth and the final hardened child prevents a substituted parent, child,
  // or different account xpub from masquerading behind a plausible path.

  let node;
  try {
    node = bip32.fromBase58(
      convertToStandardXpub(origin.xpub),
      getNetwork(network),
    );
  } catch {
    throw new Error('Canonical descriptor extended key is invalid or does not match wallet network');
  }

  const declaredDepth = accountPath.split('/').length - 1;
  if (node.depth !== declaredDepth) {
    throw new Error('Canonical descriptor extended key depth does not match account origin');
  }

  // BIP48 account xpubs are serialized at the final hardened /1' or /2'
  // script-type child; BIP44/49/84/86 account xpubs end at the account child.
  const finalOriginIndex = parsedPath.policy.bip48ScriptType ?? parsedPath.account;
  if (node.index !== finalOriginIndex + HARDENED_INDEX_OFFSET) {
    throw new Error('Canonical descriptor extended key child number does not match account origin');
  }
}

function assertCanonicalExtendedKeyBindings(
  parsed: ParsedDescriptor,
  network: AddressDerivationNetwork,
): void {
  for (const origin of descriptorExtendedKeyOrigins(parsed)) {
    assertExtendedKeyOriginBinding(origin, network, parsed.type);
  }
}

/**
 * Derive from the exact persisted receive/change descriptor selected by the
 * wallet-relative coordinate. Unlike the compatibility API below, this never
 * rewrites an explicit descriptor branch.
 */
export function deriveCanonicalAddress(
  descriptors: { receiveDescriptor: string; changeDescriptor: string },
  coordinate: { branch: 0 | 1; index: number; network: AddressDerivationNetwork },
  deps: DescriptorDerivationDeps = {}
): CanonicalDerivedAddress {
  assertCanonicalCoordinate(coordinate.branch, coordinate.index);
  const descriptor = coordinate.branch === 0
    ? descriptors.receiveDescriptor
    : descriptors.changeDescriptor;
  const parsed = parseDescriptor(descriptor);
  assertDescriptorBranch(parsed, coordinate.branch);
  const signerOrigins = canonicalSignerOrigins(parsed, coordinate.branch, coordinate.index);
  assertCanonicalExtendedKeyBindings(parsed, coordinate.network);
  const derived = deriveAddressFromParsedDescriptor(
    parsed,
    coordinate.index,
    { network: coordinate.network, change: coordinate.branch === 1 },
    deps
  );
  const derivationPath = `${signerOrigins[0].accountPath}/${coordinate.branch}/${coordinate.index}`;
  return {
    ...derived,
    derivationPath,
    branch: coordinate.branch,
    index: coordinate.index,
    scriptPubKey: Buffer.from(bitcoin.address
      .toOutputScript(derived.address, getNetwork(coordinate.network)))
      .toString('hex'),
    signerOrigins,
  };
}

/**
 * Derive address from descriptor
 */
export function deriveAddressFromDescriptor(
  descriptor: string,
  index: number,
  options: {
    network?: AddressDerivationNetwork;
    change?: boolean;
  } = {}
): DerivedAddress {
  const parsed = parseDescriptor(descriptor);
  return deriveAddressFromParsedDescriptor(parsed, index, options);
}

/**
 * Derive address from a pre-parsed descriptor.
 * Useful for callers that already validated/parsing descriptors and for targeted branch testing.
 */
export function deriveAddressFromParsedDescriptor(
  parsed: ParsedDescriptor,
  index: number,
  options: {
    network?: AddressDerivationNetwork;
    change?: boolean;
  } = {},
  deps: DescriptorDerivationDeps = {}
): DerivedAddress {
  const { network = 'mainnet', change = false } = options;

  // Handle multisig descriptors
  if (parsed.type === 'wsh-sortedmulti' || parsed.type === 'sh-wsh-sortedmulti') {
    return deriveMultisigAddress(parsed, index, { network, change }, deps);
  }

  // Map descriptor type to script type for single-sig
  const scriptTypeMap: Record<'wpkh' | 'sh-wpkh' | 'tr' | 'pkh', WalletScriptTypeValue> = {
    wpkh: WalletScriptType.NATIVE_SEGWIT,
    'sh-wpkh': WalletScriptType.NESTED_SEGWIT,
    tr: WalletScriptType.TAPROOT,
    pkh: WalletScriptType.LEGACY,
  };

  const scriptType = scriptTypeMap[parsed.type as 'wpkh' | 'sh-wpkh' | 'tr' | 'pkh'];

  if (!parsed.xpub) {
    throw new Error('No xpub found in descriptor');
  }

  return deriveAddress(parsed.xpub, index, {
    scriptType,
    network,
    change,
  });
}

/**
 * Derive multiple addresses from descriptor at once
 */
export function deriveAddressesFromDescriptor(
  descriptor: string,
  startIndex: number,
  count: number,
  options: {
    network?: AddressDerivationNetwork;
    change?: boolean;
  } = {}
): Array<{
  address: string;
  derivationPath: string;
  index: number;
}> {
  const addresses: Array<{
    address: string;
    derivationPath: string;
    index: number;
  }> = [];

  for (let i = 0; i < count; i++) {
    const index = startIndex + i;
    const { address, derivationPath } = deriveAddressFromDescriptor(descriptor, index, options);
    addresses.push({ address, derivationPath, index });
  }

  return addresses;
}
