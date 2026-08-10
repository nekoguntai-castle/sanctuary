import { deriveAddressFromDescriptor } from '../bitcoin/addressDerivation';
import type { AddressDerivationNetwork } from '../bitcoin/addressDerivation/types';
import type { ParsedDescriptor } from '../bitcoin/descriptorParser/types';
import type {
  RawAuditAddress,
  RawAuditWallet,
  WalletAuditFindingId,
} from './schema';

const AUDIT_NETWORKS = new Set<AddressDerivationNetwork>([
  'mainnet',
  'testnet',
  'testnet3',
  'testnet4',
  'signet',
  'regtest',
]);

function auditNetwork(network: string): AddressDerivationNetwork | null {
  return AUDIT_NETWORKS.has(network as AddressDerivationNetwork)
    ? network as AddressDerivationNetwork
    : null;
}

function addressBranch(address: RawAuditAddress): 0 | 1 | null {
  const match = address.derivationPath.match(/\/([01])\/(\d+)$/);
  if (!match || Number.parseInt(match[2], 10) !== address.index) return null;
  return match[1] === '0' ? 0 : 1;
}

function expectedPath(parsed: ParsedDescriptor, branch: 0 | 1, index: number): string | null {
  const origins = new Set(parsed.devices.map((device) => device.derivationPath));
  if (origins.size !== 1) return null;
  const origin = parsed.devices[0]?.derivationPath;
  return origin ? `${origin}/${branch}/${index}` : null;
}

interface AddressMatchResult {
  addressMatches: boolean;
  pathMatches: boolean;
}

function inspectAddress(
  wallet: RawAuditWallet,
  address: RawAuditAddress,
  receive: ParsedDescriptor,
  change: ParsedDescriptor,
): AddressMatchResult {
  const branch = addressBranch(address);
  const network = auditNetwork(wallet.network);
  if (branch === null || network === null) return { addressMatches: false, pathMatches: false };

  const descriptor = branch === 0 ? wallet.descriptor : wallet.changeDescriptor;
  const parsed = branch === 0 ? receive : change;
  if (!descriptor) return { addressMatches: false, pathMatches: false };

  try {
    const derived = deriveAddressFromDescriptor(descriptor, address.index, {
      network,
      change: branch === 1,
    });
    return {
      addressMatches: derived.address === address.address,
      pathMatches: expectedPath(parsed, branch, address.index) === address.derivationPath,
    };
  } catch {
    return { addressMatches: false, pathMatches: false };
  }
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
  const paths = new Set<string>();
  for (const address of addresses) {
    if (paths.has(address.derivationPath)) findings.add('address.path_inconsistent');
    paths.add(address.derivationPath);
    const result = inspectAddress(wallet, address, receive, change);
    if (!result.addressMatches) findings.add('address.policy_mismatch');
    if (!result.pathMatches) findings.add('address.path_inconsistent');
  }
  return [...findings];
}
