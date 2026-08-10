/**
 * Builds the immutable descriptor policy written at a wallet boundary.
 * Runtime descriptors are checksum-free canonical branch members, while the
 * exact imported tokens and checksums remain untouched as recovery evidence.
 */
import { WalletScriptType, WalletType } from '@sanctuary/shared/constants/walletIdentity';
import { MasterFingerprintSchema } from '@sanctuary/shared/schemas/deviceIdentity';
import { InvalidInputError } from '../../errors';
import { parseDescriptorForImport } from '../bitcoin/descriptorParser';
import { removeChecksum } from '../bitcoin/descriptorParser/checksum';

export type DescriptorSourceKind =
  | 'generated_pair'
  | 'imported_pair'
  | 'imported_multipath';

export interface PreparedDescriptorPolicy {
  descriptor: string;
  changeDescriptor: string;
  descriptorPolicyVersion: 1;
  descriptorSourceKind: DescriptorSourceKind;
  sourceDescriptor: string;
  sourceChangeDescriptor: string | null;
  sourceDescriptorChecksum: string | null;
  sourceChangeDescriptorChecksum: string | null;
}

interface PrepareDescriptorPolicyInput {
  receiveDescriptor: string;
  changeDescriptor?: string;
  sourceKind: 'generated_pair' | 'imported';
}

/** Extract the ordered signer fingerprints that bind a descriptor policy. */
export const descriptorPolicyFingerprint = (descriptor: string): string =>
  parseDescriptorForImport(descriptor).devices
    .map((device) => device.fingerprint)
    .join('-');

const CHECKSUM_PATTERN = /#([qpzry9x8gf2tvdw0s3jn54khce6mua7l]{8})$/;

const checksumOf = (descriptor: string): string | null =>
  descriptor.match(CHECKSUM_PATTERN)?.[1] ?? null;

const assertExactToken = (descriptor: string, label: string): void => {
  if (descriptor.length === 0 || descriptor !== descriptor.trim()) {
    throw new InvalidInputError(`${label} must be an exact non-empty descriptor token`);
  }
};

const rejectUnsupportedPolicy = (descriptor: string): void => {
  // These policies lack complete derivation/signing proof in Sanctuary. Never
  // normalize them into a different policy or silently derive an address.
  if (/(^|\()multi\(/i.test(descriptor)) {
    throw new InvalidInputError('Ordered multi descriptors are not supported');
  }
  if (/^tr\([^,]+,/i.test(descriptor)) {
    throw new InvalidInputError('Taproot script-tree descriptors are not supported');
  }
};

const comparablePolicy = (descriptor: string) => {
  rejectUnsupportedPolicy(descriptor);
  const parsed = parseDescriptorForImport(descriptor);
  if (parsed.devices.some(device => !MasterFingerprintSchema.safeParse(device.fingerprint).success)) {
    throw new InvalidInputError('Descriptor requires a nonzero BIP32 master fingerprint for every signer');
  }
  if (
    parsed.type === WalletType.MULTI_SIG
    && parsed.scriptType === WalletScriptType.LEGACY
  ) {
    throw new InvalidInputError('Legacy multisig descriptors are not supported');
  }
  return {
    type: parsed.type,
    scriptType: parsed.scriptType,
    devices: parsed.devices,
    network: parsed.network,
    quorum: parsed.quorum ?? null,
    totalSigners: parsed.totalSigners ?? null,
  };
};

const assertMatchingPair = (receiveDescriptor: string, changeDescriptor: string): void => {
  const receive = parseDescriptorForImport(receiveDescriptor);
  const change = parseDescriptorForImport(changeDescriptor);
  if (receive.isChange || !change.isChange) {
    throw new InvalidInputError('Descriptor pair must contain receive branch 0 and change branch 1');
  }
  if (
    // comparablePolicy creates the same ordered field shape for both branches;
    // JSON equality therefore preserves signer order as well as policy fields.
    JSON.stringify(comparablePolicy(receiveDescriptor))
    !== JSON.stringify(comparablePolicy(changeDescriptor))
  ) {
    throw new InvalidInputError('Receive and change descriptors do not describe the same wallet policy');
  }
};

const expandMultipath = (descriptor: string): { receive: string; change: string } => {
  // BIP389 permits broader tuples, but the product proves only the conventional
  // receive/change pair where 0 is external and 1 is internal.
  const withoutChecksum = removeChecksum(descriptor);
  if (!withoutChecksum.includes('<0;1>/*')) {
    throw new InvalidInputError('Descriptor import requires an explicit receive/change pair');
  }
  const withoutSupportedRanges = withoutChecksum.replace(/<0;1>/g, '');
  if (/[<>]/.test(withoutSupportedRanges)) {
    throw new InvalidInputError('Only BIP389 <0;1>/* multipath descriptors are supported');
  }
  return {
    receive: withoutChecksum.replace(/<0;1>/g, '0'),
    change: withoutChecksum.replace(/<0;1>/g, '1'),
  };
};

/**
 * Validate a complete receive/change policy and retain the exact source
 * descriptor tokens as immutable recovery evidence.
 */
export function prepareDescriptorPolicy(
  input: PrepareDescriptorPolicyInput,
): PreparedDescriptorPolicy {
  assertExactToken(input.receiveDescriptor, 'Receive descriptor');
  rejectUnsupportedPolicy(input.receiveDescriptor);

  if (input.changeDescriptor !== undefined) {
    assertExactToken(input.changeDescriptor, 'Change descriptor');
    rejectUnsupportedPolicy(input.changeDescriptor);
    if (/[<>]/.test(input.receiveDescriptor) || /[<>]/.test(input.changeDescriptor)) {
      throw new InvalidInputError('Explicit descriptor pairs cannot contain multipath ranges');
    }
    const descriptor = removeChecksum(input.receiveDescriptor);
    const changeDescriptor = removeChecksum(input.changeDescriptor);
    assertMatchingPair(descriptor, changeDescriptor);
    return {
      descriptor,
      changeDescriptor,
      descriptorPolicyVersion: 1,
      descriptorSourceKind: input.sourceKind === 'generated_pair'
        ? 'generated_pair'
        : 'imported_pair',
      sourceDescriptor: input.receiveDescriptor,
      sourceChangeDescriptor: input.changeDescriptor,
      sourceDescriptorChecksum: checksumOf(input.receiveDescriptor),
      sourceChangeDescriptorChecksum: checksumOf(input.changeDescriptor),
    };
  }

  if (input.sourceKind === 'generated_pair') {
    throw new InvalidInputError('Generated wallet policy requires receive and change descriptors');
  }
  const expanded = expandMultipath(input.receiveDescriptor);
  assertMatchingPair(expanded.receive, expanded.change);
  return {
    descriptor: expanded.receive,
    changeDescriptor: expanded.change,
    descriptorPolicyVersion: 1,
    descriptorSourceKind: 'imported_multipath',
    sourceDescriptor: input.receiveDescriptor,
    sourceChangeDescriptor: null,
    sourceDescriptorChecksum: checksumOf(input.receiveDescriptor),
    sourceChangeDescriptorChecksum: null,
  };
}
