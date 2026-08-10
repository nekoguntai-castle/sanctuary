import { ForbiddenError } from '../errors';
import { assertWalletHardwareCapabilityById } from './hardwareWalletCapabilities';
import {
  assertCanonicalAddressesForWallet,
  CanonicalAddressValidationError,
} from './wallet/canonicalAddressValidation';

interface DisplayAddressEvidence {
  used: boolean;
  walletId: string;
  address: string;
  derivationPath: string;
  index: number;
  branch: number | null;
  coordinateVersion: number | null;
  canonicalPolicyId: string | null;
  canonicalPolicyVersion: number | null;
  scriptPubKey: string | null;
}

/**
 * Prevents an unused address from being shown as a deposit destination unless
 * it is re-derived from the owning wallet and its hardware row permits display.
 */
export async function assertUnusedAddressesSafeForDisplay(
  walletId: string,
  addresses: readonly DisplayAddressEvidence[],
): Promise<void> {
  const unused = addresses.filter(address => address.used !== true);
  if (unused.length === 0) return;
  await assertWalletHardwareCapabilityById(walletId, 'display');
  try {
    await assertCanonicalAddressesForWallet(walletId, unused);
  } catch (error) {
    if (!(error instanceof CanonicalAddressValidationError)) throw error;
    throw new ForbiddenError('Unused address lacks complete canonical safety evidence');
  }
}

/** Applies the same ownership proof to a new branch-0 payment request. */
export async function assertFreshReceiveAddressSafeForDisplay(
  walletId: string,
  address: DisplayAddressEvidence,
): Promise<void> {
  if (address.used === true) {
    throw new ForbiddenError('Fresh payment requests cannot reuse a used wallet address');
  }
  await assertWalletHardwareCapabilityById(walletId, 'display');
  try {
    await assertCanonicalAddressesForWallet(walletId, [address], 0);
  } catch (error) {
    if (!(error instanceof CanonicalAddressValidationError)) throw error;
    throw new ForbiddenError('Fresh receive address lacks canonical safety evidence');
  }
}
