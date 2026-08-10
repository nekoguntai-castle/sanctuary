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
