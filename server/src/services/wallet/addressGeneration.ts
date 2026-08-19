/**
 * Address Generation
 *
 * Address derivation and gap limit management for wallets.
 */

import { walletRepository, addressRepository } from '../../repositories';
import * as addressDerivation from '../bitcoin/addressDerivation';
import { createLogger } from '../../utils/logger';
import { getErrorMessage } from '../../utils/errors';
import { INITIAL_ADDRESS_COUNT } from '../../constants';
import { hookRegistry, Operations } from '../hooks';
import { InvalidInputError, WalletNotFoundError } from '../../errors';
import type { WalletNetwork } from './types';
import { assertWalletHardwareCapabilityById } from '../hardwareWalletCapabilities';
import {
  assertPersistedCanonicalPolicy,
  type CanonicalPolicyIdentity,
} from './canonicalPolicy';
import type { NextCanonicalAddressData } from '../../repositories/addressRepository';
import { CANONICAL_ADDRESS_COORDINATE_VERSION } from '@sanctuary/shared/constants/walletPolicy';

type CanonicalAddressEvidence = NextCanonicalAddressData & { used: false };

const log = createLogger('WALLET:SVC_ADDRESS');

export interface InitialAddressTemplate {
  address: string;
  derivationPath: string;
  scriptPubKey: string;
  branch: 0 | 1;
  coordinateVersion: typeof CANONICAL_ADDRESS_COORDINATE_VERSION;
  canonicalPolicyId: string;
  canonicalPolicyVersion: number;
  index: number;
  used: false;
}

/**
 * Derives the exact address/path/script tuple persisted as canonical evidence.
 * Callers must pass the owning wallet's descriptor pair and persisted policy
 * identity; this function does not infer or repair either trust anchor.
 */
export function buildCanonicalAddressEvidence(
  receiveDescriptor: string,
  changeDescriptor: string,
  network: WalletNetwork,
  policyIdentity: CanonicalPolicyIdentity,
  branch: 0 | 1,
  index: number,
): CanonicalAddressEvidence {
  const derived = addressDerivation.deriveCanonicalAddress(
    { receiveDescriptor, changeDescriptor },
    { branch, index, network },
  );
  return {
    address: derived.address,
    derivationPath: derived.derivationPath,
    scriptPubKey: derived.scriptPubKey,
    coordinateVersion: CANONICAL_ADDRESS_COORDINATE_VERSION,
    ...policyIdentity,
    used: false,
  };
}

/**
 * Derive the initial receive and change windows before any wallet data is
 * written, allowing callers to fail the enclosing operation atomically.
 */
export function buildInitialAddressTemplates(
  receiveDescriptor: string,
  changeDescriptor: string,
  network: WalletNetwork,
  policyIdentity: CanonicalPolicyIdentity,
): InitialAddressTemplate[] {
  const addresses: InitialAddressTemplate[] = [];
  for (const branch of [0, 1] as const) {
    for (let index = 0; index < INITIAL_ADDRESS_COUNT; index++) {
      addresses.push({
        ...buildCanonicalAddressEvidence(
          receiveDescriptor, changeDescriptor, network, policyIdentity, branch, index,
        ),
        branch,
        index,
      });
    }
  }
  return addresses;
}

/**
 * Generate initial receive and change addresses for a wallet descriptor.
 * Returns address records ready for bulk insert from the independently
 * validated receive and change descriptor pair.
 */
export function generateInitialAddresses(
  walletId: string,
  receiveDescriptor: string,
  network: WalletNetwork,
  changeDescriptor: string,
  policyIdentity: CanonicalPolicyIdentity,
): Array<InitialAddressTemplate & { walletId: string }> {
  return buildInitialAddressTemplates(
    receiveDescriptor,
    changeDescriptor,
    network,
    policyIdentity,
  )
    .map((address) => ({ walletId, ...address }));
}

/**
 * Generate new receiving address for wallet
 */
export async function generateAddress(
  walletId: string,
  userId: string
): Promise<string> {
  const wallet = await walletRepository.findByIdWithAccessAndInclude(walletId, userId, {
    addresses: false,
  });

  if (!wallet) {
    throw new WalletNotFoundError(walletId);
  }

  await assertWalletHardwareCapabilityById(walletId, 'display');

  if (!wallet.descriptor || !wallet.changeDescriptor) {
    // Do not advise re-importing: import always creates a NEW wallet, so it would strand
    // this wallet's id, labels, transaction history, sharing and policies. A wallet that
    // has a descriptor but no policy is recoverable in place through remediation.
    throw new InvalidInputError(
      wallet.descriptor
        ? 'Wallet predates descriptor policies and cannot derive addresses yet. '
          + 'Run wallet remediation to recover its descriptor policy in place.'
        : 'Wallet does not have a descriptor. Cannot derive addresses.'
    );
  }

  const policy = assertPersistedCanonicalPolicy(wallet);
  const created = await addressRepository.createNextCanonical(walletId, 0, (index) => {
    return buildCanonicalAddressEvidence(
      wallet.descriptor as string,
      wallet.changeDescriptor as string,
      wallet.network as WalletNetwork,
      { canonicalPolicyId: policy.id, canonicalPolicyVersion: policy.version },
      0,
      index,
    );
  });
  const { address } = created;

  // Execute after hooks for audit logging
  hookRegistry.executeAfter(Operations.ADDRESS_GENERATE, { walletId }, {
    userId,
    result: address,
    success: true,
  }).catch(err => log.warn('After hook failed', { error: getErrorMessage(err) }));

  return address;
}
