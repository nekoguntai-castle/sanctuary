/**
 * Builds the immutable descriptor policy written at a wallet boundary.
 * Runtime descriptors are checksum-free canonical branch members, while the
 * exact imported tokens and checksums remain untouched as recovery evidence.
 */
import { InvalidInputError } from '../../errors';
import {
  expandCanonicalMultipathDescriptor,
  parseCanonicalDescriptor,
  validateCanonicalDescriptorPair,
} from '../bitcoin/descriptorParser';

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
  parseCanonicalDescriptor(descriptor).keys
    .map((key) => key.fingerprint)
    .join('-');

const assertExactToken = (descriptor: string, label: string): void => {
  if (descriptor.length === 0 || descriptor !== descriptor.trim()) {
    throw new InvalidInputError(`${label} must be an exact non-empty descriptor token`);
  }
};

const invalidDescriptor = (error: unknown): never => {
  const message = error instanceof Error ? error.message : 'Invalid descriptor policy';
  throw new InvalidInputError(message);
};

/**
 * Validate a complete receive/change policy and retain the exact source
 * descriptor tokens as immutable recovery evidence.
 */
export function prepareDescriptorPolicy(
  input: PrepareDescriptorPolicyInput,
): PreparedDescriptorPolicy {
  assertExactToken(input.receiveDescriptor, 'Receive descriptor');

  if (input.changeDescriptor !== undefined) {
    assertExactToken(input.changeDescriptor, 'Change descriptor');
    try {
      const { receive, change } = validateCanonicalDescriptorPair(
        input.receiveDescriptor,
        input.changeDescriptor,
      );
      return {
        descriptor: receive.body,
        changeDescriptor: change.body,
        descriptorPolicyVersion: 1,
        descriptorSourceKind: input.sourceKind === 'generated_pair'
          ? 'generated_pair'
          : 'imported_pair',
        sourceDescriptor: input.receiveDescriptor,
        sourceChangeDescriptor: input.changeDescriptor,
        sourceDescriptorChecksum: receive.checksum ?? null,
        sourceChangeDescriptorChecksum: change.checksum ?? null,
      };
    } catch (error) {
      return invalidDescriptor(error);
    }
  }

  if (input.sourceKind === 'generated_pair') {
    throw new InvalidInputError('Generated wallet policy requires receive and change descriptors');
  }
  try {
    const source = parseCanonicalDescriptor(input.receiveDescriptor);
    const expanded = expandCanonicalMultipathDescriptor(input.receiveDescriptor);
    validateCanonicalDescriptorPair(expanded.receiveDescriptor, expanded.changeDescriptor);
    return {
      descriptor: expanded.receiveDescriptor,
      changeDescriptor: expanded.changeDescriptor,
      descriptorPolicyVersion: 1,
      descriptorSourceKind: 'imported_multipath',
      sourceDescriptor: input.receiveDescriptor,
      sourceChangeDescriptor: null,
      sourceDescriptorChecksum: source.checksum ?? null,
      sourceChangeDescriptorChecksum: null,
    };
  } catch (error) {
    return invalidDescriptor(error);
  }
}
