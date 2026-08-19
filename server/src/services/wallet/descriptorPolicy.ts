/**
 * Builds the immutable descriptor policy written at a wallet boundary.
 * Runtime descriptors are checksum-free canonical branch members, while the
 * exact imported tokens and checksums remain untouched as recovery evidence.
 */
import { InvalidInputError } from '../../errors';
import {
  expandCanonicalMultipathDescriptor,
  parseCanonicalDescriptor,
  renderCanonicalDescriptor,
  validateCanonicalDescriptorPair,
} from '../bitcoin/descriptorParser';
import { buildChangeDescriptor } from '../bitcoin/descriptorBuilder';

/**
 * What each value asserts about where a wallet's descriptor came from. These are
 * provenance claims, not formats, and they are immutable once written.
 *
 * - `generated_pair`      Sanctuary materialised both descriptors from key material it holds.
 * - `imported_pair`       a human supplied both descriptor tokens verbatim.
 * - `imported_multipath`  a human supplied one multipath token, expanded into a pair.
 * - `recovered_legacy`    nobody's origin was ever recorded. This wallet predates descriptor
 *                         policies; its stored receive descriptor is the only token it has
 *                         ever had, and the change descriptor was derived from it by
 *                         canonical branch substitution and then proven by re-deriving every
 *                         address the wallet already holds. Reachable ONLY from the wallet
 *                         remediation flow — never from wallet creation, import or linking.
 */
export type DescriptorSourceKind =
  | 'generated_pair'
  | 'imported_pair'
  | 'imported_multipath'
  | 'recovered_legacy';

/** Provenance kinds a wallet can acquire at creation, import or device linking. */
export type OriginatedDescriptorSourceKind = Exclude<DescriptorSourceKind, 'recovered_legacy'>;

export interface PreparedDescriptorPolicy<
  Kind extends DescriptorSourceKind = OriginatedDescriptorSourceKind,
> {
  descriptor: string;
  changeDescriptor: string;
  descriptorPolicyVersion: 1;
  descriptorSourceKind: Kind;
  sourceDescriptor: string;
  sourceChangeDescriptor: string | null;
  sourceDescriptorChecksum: string | null;
  sourceChangeDescriptorChecksum: string | null;
}

export type PreparedRecoveredDescriptorPolicy = PreparedDescriptorPolicy<'recovered_legacy'>;

/** Any prepared policy, whatever its provenance. */
export type AnyPreparedDescriptorPolicy = PreparedDescriptorPolicy<DescriptorSourceKind>;

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
 * Reconstruct the descriptor policy of a wallet that predates descriptor policies.
 *
 * The change descriptor is DERIVED, never supplied: `buildChangeDescriptor` is the same
 * canonical branch substitution wallet creation has always used, so recovery reproduces
 * what creation would have written rather than inventing a second token. `sourceDescriptor`
 * is pinned to the stored receive descriptor byte-for-byte, and `sourceChangeDescriptor`
 * stays null because no second token was ever supplied — recording the derived token there
 * would claim provenance that does not exist.
 *
 * The stored descriptor must already be canonical and checksum-free. The descriptor column
 * is frozen by `protect_wallet_descriptor_policy` the instant a policy is assigned, so a
 * descriptor that would need normalising can never be reconciled afterwards; blocking is
 * the only safe answer. This function proves nothing about the wallet's addresses — that
 * obligation lives in the remediation proof, which re-derives every one of them.
 */
export function prepareRecoveredLegacyDescriptorPolicy(
  receiveDescriptor: string,
): PreparedRecoveredDescriptorPolicy {
  assertExactToken(receiveDescriptor, 'Stored descriptor');
  try {
    const parsed = parseCanonicalDescriptor(receiveDescriptor);
    if (parsed.checksum !== undefined) {
      throw new Error('Recovered descriptor must not carry a checksum');
    }
    if (renderCanonicalDescriptor(parsed) !== receiveDescriptor) {
      throw new Error('Recovered descriptor is not already canonical');
    }
    const derivedChange = buildChangeDescriptor(receiveDescriptor);
    const { receive, change } = validateCanonicalDescriptorPair(receiveDescriptor, derivedChange);
    return {
      descriptor: receive.body,
      changeDescriptor: change.body,
      descriptorPolicyVersion: 1,
      descriptorSourceKind: 'recovered_legacy',
      sourceDescriptor: receiveDescriptor,
      sourceChangeDescriptor: null,
      sourceDescriptorChecksum: null,
      sourceChangeDescriptorChecksum: null,
    };
  } catch (error) {
    return invalidDescriptor(error);
  }
}

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
