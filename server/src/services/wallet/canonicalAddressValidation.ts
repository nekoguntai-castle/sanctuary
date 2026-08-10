import { isNetworkType, type NetworkType } from '@sanctuary/shared/constants/bitcoin';
import type { Address, Wallet } from '../../generated/prisma/client';
import { InvalidInputError, WalletNotFoundError } from '../../errors';
import { walletRepository } from '../../repositories';
import { buildCanonicalAddressEvidence } from './addressGeneration';
import { assertPersistedCanonicalPolicy, hasCompleteCanonicalAddressEvidence } from './canonicalPolicy';

type CanonicalWallet = Pick<Wallet,
  'id' | 'type' | 'scriptType' | 'network' | 'descriptor' | 'changeDescriptor'
  | 'canonicalPolicyId' | 'canonicalPolicyVersion'>;
type CanonicalAddress = Pick<Address,
  'walletId' | 'address' | 'derivationPath' | 'index' | 'branch' | 'coordinateVersion'
  | 'canonicalPolicyId' | 'canonicalPolicyVersion' | 'scriptPubKey'>;

export const CANONICAL_ADDRESS_VALIDATION_CHUNK_SIZE = 25;

export class CanonicalAddressValidationError extends InvalidInputError {
  constructor(message: string) {
    super(message);
    this.name = 'CanonicalAddressValidationError';
  }
}

function canonicalNetwork(value: string): NetworkType {
  if (value === 'testnet') return 'testnet3';
  if (isNetworkType(value)) return value;
  throw new CanonicalAddressValidationError('Wallet network is not canonical');
}

function canonicalWalletPolicy(wallet: CanonicalWallet) {
  try {
    return assertPersistedCanonicalPolicy(wallet);
  } catch (error) {
    if (error instanceof InvalidInputError) {
      throw new CanonicalAddressValidationError(error.message);
    }
    throw error;
  }
}

function assertAddressEligibility(
  wallet: CanonicalWallet,
  address: CanonicalAddress,
  policy: { id: string; version: number },
  expectedBranch?: 0 | 1,
): asserts address is CanonicalAddress & { branch: 0 | 1 } {
  const wrongBranch = expectedBranch !== undefined && address.branch !== expectedBranch;
  if (address.walletId !== wallet.id
    || !hasCompleteCanonicalAddressEvidence(address)
    || address.canonicalPolicyId !== policy.id
    || address.canonicalPolicyVersion !== policy.version
    || wrongBranch) {
    throw new CanonicalAddressValidationError('Address is not eligible for canonical wallet use');
  }
}

function rederiveCanonicalAddress(
  wallet: CanonicalWallet & { descriptor: string; changeDescriptor: string },
  address: CanonicalAddress & { branch: 0 | 1 },
  network: NetworkType,
  policy: { id: string; version: number },
) {
  try {
    return buildCanonicalAddressEvidence(
      wallet.descriptor,
      wallet.changeDescriptor,
      network,
      { canonicalPolicyId: policy.id, canonicalPolicyVersion: policy.version },
      address.branch,
      address.index,
    );
  } catch {
    throw new CanonicalAddressValidationError('Canonical address re-derivation failed');
  }
}

export function assertCanonicalAddressesMatchWallet(
  wallet: CanonicalWallet,
  addresses: readonly CanonicalAddress[],
  expectedBranch?: 0 | 1,
): void {
  // Stored coordinates are evidence, not the trust anchor: re-derive from the
  // wallet's authoritative descriptor pair before an address can receive funds.
  if (!wallet.descriptor || !wallet.changeDescriptor) {
    throw new CanonicalAddressValidationError('Wallet descriptor policy is incomplete');
  }
  const policy = canonicalWalletPolicy(wallet);
  const network = canonicalNetwork(wallet.network);
  for (const address of addresses) {
    assertAddressEligibility(wallet, address, policy, expectedBranch);
    const derived = rederiveCanonicalAddress(
      wallet as CanonicalWallet & { descriptor: string; changeDescriptor: string },
      address,
      network,
      policy,
    );
    if (address.address !== derived.address
      || address.derivationPath !== derived.derivationPath
      || address.scriptPubKey !== derived.scriptPubKey
      || address.canonicalPolicyId !== derived.canonicalPolicyId
      || address.canonicalPolicyVersion !== derived.canonicalPolicyVersion) {
      throw new CanonicalAddressValidationError('Address does not match canonical wallet derivation');
    }
  }
}

export async function assertCanonicalAddressesForWallet(
  walletId: string,
  addresses: readonly CanonicalAddress[],
  expectedBranch?: 0 | 1,
): Promise<void> {
  if (addresses.length === 0) return;
  const wallet = await walletRepository.findById(walletId);
  if (!wallet) throw new WalletNotFoundError(walletId);
  for (let offset = 0; offset < addresses.length; offset += CANONICAL_ADDRESS_VALIDATION_CHUNK_SIZE) {
    if (offset > 0) {
      // Bound each synchronous derivation burst so large recovery exports do
      // not monopolize the server event loop.
      await new Promise<void>(resolve => setImmediate(resolve));
    }
    assertCanonicalAddressesMatchWallet(
      wallet,
      addresses.slice(offset, offset + CANONICAL_ADDRESS_VALIDATION_CHUNK_SIZE),
      expectedBranch,
    );
  }
}
