import { MAX_STANDARD_MULTISIG_KEYS } from './transactionWeight';

export const MULTISIG_SIGNER_LIMIT_MESSAGE =
  `Multisig wallets support at most ${MAX_STANDARD_MULTISIG_KEYS} signers`;

/** True when a multisig policy has more signers than Sanctuary can spend. */
export function exceedsMultisigSignerLimit(signerCount: number): boolean {
  return signerCount > MAX_STANDARD_MULTISIG_KEYS;
}

/**
 * Reject a multisig policy Sanctuary can never spend: transaction weight
 * estimation (and so every spend) is capped at 16 sortedmulti keys, and above
 * 20 keys OP_CHECKMULTISIG fails by consensus. Applied where a new policy is
 * formed: the wallet create API and service, import parsing, and descriptor
 * generation (which also runs when device linking completes an incomplete
 * multisig). Runtime descriptor parsing is not capped, so stored wallets keep
 * deriving, syncing, auditing and restoring.
 */
export function assertSupportedMultisigSignerCount(signerCount: number): void {
  if (exceedsMultisigSignerLimit(signerCount)) throw new Error(MULTISIG_SIGNER_LIMIT_MESSAGE);
}
