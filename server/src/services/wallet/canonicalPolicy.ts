import {
  CANONICAL_ADDRESS_COORDINATE_VERSION,
  findWalletPolicy,
  WALLET_POLICY_REGISTRY,
  WALLET_POLICY_REGISTRY_VERSION,
  type WalletPolicyRow,
} from '@sanctuary/shared/constants/walletPolicy';
import {
  isWalletScriptType,
  isWalletType,
} from '@sanctuary/shared/constants/walletIdentity';
import { InvalidInputError } from '../../errors';

export interface CanonicalPolicyIdentity {
  canonicalPolicyId: string;
  canonicalPolicyVersion: number;
}

export function hasCompleteCanonicalAddressEvidence(address: {
  branch?: number | null;
  coordinateVersion?: number | null;
  canonicalPolicyId?: string | null;
  canonicalPolicyVersion?: number | null;
  scriptPubKey?: string | null;
}): boolean {
  return (address.branch === 0 || address.branch === 1)
    && address.coordinateVersion === CANONICAL_ADDRESS_COORDINATE_VERSION
    && address.canonicalPolicyVersion === WALLET_POLICY_REGISTRY_VERSION
    && WALLET_POLICY_REGISTRY.some(policy => policy.id === address.canonicalPolicyId)
    && typeof address.scriptPubKey === 'string'
    && /^(?:[0-9a-f]{2})+$/.test(address.scriptPubKey);
}

/**
 * Whether a wallet may have opted into canonical address evidence.
 *
 * Wallets created before the canonical-policy scheme carry no policy identity,
 * and the database guarantees their address rows carry no coordinate evidence
 * either: `addresses_canonical_coordinate_complete_check` forces the five
 * coordinate columns to be all-null or all-set, and the
 * `addresses_enforce_wallet_policy_identity` trigger rejects any set row whose
 * policy identity differs from its wallet's. A wallet without an identity
 * therefore has nothing for `assertCanonicalAddressesMatchWallet` to compare
 * against.
 *
 * Use this only to skip a canonical comparison that cannot apply. It is NOT a
 * licence to confer ownership: paths that hand out a receive address or bind a
 * signing input must keep requiring real evidence rather than consulting this.
 *
 * `false` is the load-bearing answer, so both fields are required — a partial
 * `select` that omits them must be a compile error, not a silent skip. A
 * half-populated identity (unreachable under the CHECK constraint, but cheap to
 * defend) answers `true` so it fails closed downstream.
 */
export function hasCanonicalPolicyIdentity(wallet: {
  canonicalPolicyId: string | null;
  canonicalPolicyVersion: number | null;
}): boolean {
  return wallet.canonicalPolicyId !== null || wallet.canonicalPolicyVersion !== null;
}

export function requireCanonicalWalletPolicy(
  walletType: unknown,
  scriptType: unknown,
): WalletPolicyRow {
  if (!isWalletType(walletType) || !isWalletScriptType(scriptType)) {
    throw new InvalidInputError('Unsupported wallet policy identity');
  }
  const policy = findWalletPolicy(walletType, scriptType);
  if (!policy) throw new InvalidInputError('Unsupported wallet policy identity');
  return policy;
}

export function canonicalPolicyIdentity(policy: WalletPolicyRow): CanonicalPolicyIdentity {
  return {
    canonicalPolicyId: policy.id,
    canonicalPolicyVersion: policy.version,
  };
}

export function assertPersistedCanonicalPolicy(
  wallet: {
    type: unknown;
    scriptType: unknown;
    canonicalPolicyId?: string | null;
    canonicalPolicyVersion?: number | null;
  },
): WalletPolicyRow {
  const policy = requireCanonicalWalletPolicy(wallet.type, wallet.scriptType);
  if (wallet.canonicalPolicyId !== policy.id
    || wallet.canonicalPolicyVersion !== policy.version) {
    throw new InvalidInputError('Wallet canonical policy identity is missing or inconsistent');
  }
  return policy;
}
