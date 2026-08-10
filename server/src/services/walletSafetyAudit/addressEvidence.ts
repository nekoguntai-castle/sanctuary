import { deriveCanonicalAddress } from '../bitcoin/addressDerivation';
import type { AddressDerivationNetwork } from '../bitcoin/addressDerivation/types';
import type { ParsedDescriptor } from '../bitcoin/descriptorParser/types';
import {
  CANONICAL_ADDRESS_COORDINATE_VERSION,
  findWalletPolicy,
  WALLET_POLICY_REGISTRY_VERSION,
} from '@sanctuary/shared/constants/walletPolicy';
import {
  isWalletScriptType,
  isWalletType,
} from '@sanctuary/shared/constants/walletIdentity';
import type {
  RawAuditAddress,
  RawAuditWallet,
  WalletAuditFindingId,
} from './schema';

const AUDIT_NETWORKS = new Set<AddressDerivationNetwork>([
  'mainnet', 'testnet', 'testnet3', 'testnet4', 'signet', 'regtest',
]);

type CanonicalAuditAddress = RawAuditAddress & { branch: 0 | 1 };

const auditNetwork = (network: string): AddressDerivationNetwork | null => (
  AUDIT_NETWORKS.has(network as AddressDerivationNetwork)
    ? network as AddressDerivationNetwork
    : null
);

const hasCanonicalCoordinate = (address: RawAuditAddress): address is CanonicalAuditAddress => (
  address.coordinateVersion === CANONICAL_ADDRESS_COORDINATE_VERSION
    && (address.branch === 0 || address.branch === 1)
);

function inspectCanonicalAddress(
  wallet: RawAuditWallet,
  address: CanonicalAuditAddress,
): WalletAuditFindingId[] {
  const network = auditNetwork(wallet.network);
  if (!network || !wallet.descriptor || !wallet.changeDescriptor) return ['address.policy_mismatch'];

  const findings = new Set<WalletAuditFindingId>();
  const expectedPolicy = isWalletType(wallet.type) && isWalletScriptType(wallet.scriptType)
    ? findWalletPolicy(wallet.type, wallet.scriptType)
    : null;
  if (!expectedPolicy
    || wallet.canonicalPolicyId !== expectedPolicy.id
    || wallet.canonicalPolicyVersion !== WALLET_POLICY_REGISTRY_VERSION
    || address.canonicalPolicyId !== wallet.canonicalPolicyId
    || address.canonicalPolicyVersion !== wallet.canonicalPolicyVersion) {
    findings.add('address.policy_mismatch');
  }

  try {
    const derived = deriveCanonicalAddress(
      { receiveDescriptor: wallet.descriptor, changeDescriptor: wallet.changeDescriptor },
      { branch: address.branch, index: address.index, network },
    );
    if (derived.address !== address.address) findings.add('address.policy_mismatch');
    if (derived.derivationPath !== address.derivationPath) findings.add('address.path_inconsistent');
    if (derived.scriptPubKey !== address.scriptPubKey) findings.add('address.script_pubkey_mismatch');
  } catch {
    findings.add('address.policy_mismatch');
  }
  return [...findings];
}

export function inspectAddressEvidence(
  wallet: RawAuditWallet,
  addresses: readonly RawAuditAddress[],
  receive: ParsedDescriptor | null,
  change: ParsedDescriptor | null,
): WalletAuditFindingId[] {
  if (addresses.length === 0) return ['address.zero_addresses'];
  if (!receive || !change) return ['address.policy_mismatch'];

  const findings = new Set<WalletAuditFindingId>();
  const coordinates = new Set<string>();
  for (const address of addresses) {
    if (!hasCanonicalCoordinate(address)) {
      findings.add('address.coordinate_missing');
      continue;
    }
    const coordinate = `${address.branch}:${address.index}`;
    if (coordinates.has(coordinate)) findings.add('address.path_inconsistent');
    coordinates.add(coordinate);
    for (const finding of inspectCanonicalAddress(wallet, address)) findings.add(finding);
  }
  return [...findings];
}
