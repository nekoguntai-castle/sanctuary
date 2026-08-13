/**
 * BIP32 Derivation Builder
 *
 * Builds BIP32 derivation entries for hardware wallet signing in multisig PSBTs.
 */

import * as bitcoin from 'bitcoinjs-lib';
import bip32 from '../bip32';
import { convertToStandardXpub, MultisigKeyInfo } from '../addressDerivation';
import { createLogger } from '../../../utils/logger';
import {
  normalizeDerivationPath,
} from '@sanctuary/shared/utils/bitcoin';
import {
  buildCanonicalAddressPath,
  parseCanonicalAccountPath,
  parseCanonicalAddressPath,
} from '@sanctuary/shared/constants/walletPolicy';
import type { Bip32DerivationEntry } from './types';

const log = createLogger('BITCOIN:SVC_PSBT_DERIV');

/**
 * Build BIP32 derivation entries for all cosigners in a multisig wallet.
 *
 * This function creates the bip32Derivation field data needed for hardware wallets
 * to identify which keys belong to them when signing multisig transactions.
 *
 * For each cosigner in the multisig, it:
 * 1. Derives the public key at the address path (change/index) from their xpub
 * 2. Constructs the full derivation path (m/{accountPath}/{change}/{index})
 * 3. Returns the fingerprint, path, and derived pubkey
 *
 * @param derivationPath - Full derivation path for the address (e.g., "m/48'/0'/0'/2'/0/5")
 * @param multisigKeys - Array of cosigner key info from parsed descriptor
 * @param network - Bitcoin network object
 * @param inputIndex - Optional input index for logging
 * @returns Array of bip32Derivation entries, or empty array on failure
 */
export function buildMultisigBip32Derivations(
  derivationPath: string,
  multisigKeys: MultisigKeyInfo[],
  network: bitcoin.Network,
  inputIndex?: number
): Bip32DerivationEntry[] {
  try {
    // Extract change/index from the derivation path (e.g., m/48'/0'/0'/2'/0/5 -> 0, 5)
    const parsedAddress = parseCanonicalAddressPath(normalizeDerivationPath(derivationPath));
    if (!parsedAddress) throw new Error('Invalid canonical address derivation path');
    const { branch: changeIdx, index: addressIdx } = parsedAddress;

    const bip32Derivations: Bip32DerivationEntry[] = [];

    for (const keyInfo of multisigKeys) {
      try {
        const signerAccount = parseCanonicalAccountPath(
          normalizeDerivationPath(keyInfo.accountPath),
        );
        if (!signerAccount) throw new Error('Multisig signer account is not canonical');
        // Convert xpub to standard format and create BIP32 node
        const standardXpub = convertToStandardXpub(keyInfo.xpub);
        const keyNode = bip32.fromBase58(standardXpub, network);

        // Derive at change/index level from this key's xpub
        const derivedNode = keyNode.derive(changeIdx).derive(addressIdx);

        if (derivedNode.publicKey) {
          // Build full path for this key: m/{accountPath}/{change}/{index}
          // Normalize to apostrophe notation for PSBT compatibility
          const fullPath = buildCanonicalAddressPath(
            signerAccount.path,
            changeIdx,
            addressIdx,
          );

          bip32Derivations.push({
            masterFingerprint: Buffer.from(keyInfo.fingerprint, 'hex'),
            path: fullPath,
            pubkey: Buffer.from(derivedNode.publicKey),
          });

          log.debug('Multisig bip32Derivation added', {
            inputIndex,
            fingerprint: keyInfo.fingerprint,
            path: fullPath,
            pubkeyPrefix: Buffer.from(derivedNode.publicKey).toString('hex').substring(0, 16),
          });
        }
      } catch (keyError) {
        log.warn('Failed to derive key for multisig input', {
          inputIndex,
          fingerprint: keyInfo.fingerprint,
          error: (keyError as Error).message,
        });
      }
    }

    if (bip32Derivations.length > 0) {
      log.info('Multisig BIP32 derivations built', {
        inputIndex,
        derivationCount: bip32Derivations.length,
        fingerprints: bip32Derivations.map(d => d.masterFingerprint.toString('hex')),
      });
    }

    return bip32Derivations;
  } catch (e) {
    log.warn('Multisig BIP32 derivation failed', {
      inputIndex,
      error: (e as Error).message,
    });
    return [];
  }
}
