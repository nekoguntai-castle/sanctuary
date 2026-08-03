/**
 * Multisig Utilities
 *
 * Building Trezor multisig structures from PSBT data and detecting
 * multisig inputs.
 */

import { createLogger } from '../../../../utils/logger';
import { convertToStandardXpub } from './xpubUtils';
import type { TrezorMultisig, TrezorMultisigPubkey } from './types';

/** Subset of PSBT input fields used for multisig detection (compatible with both bip174 Buffer and Uint8Array variants) */
interface PsbtInputLike {
  witnessScript?: Uint8Array;
  redeemScript?: Uint8Array;
  bip32Derivation?: readonly { pubkey: Uint8Array; masterFingerprint: Uint8Array; path: string }[];
}

const log = createLogger('TrezorAdapter');

/**
 * Build Trezor multisig structure from PSBT input data.
 * This is required for Trezor to properly validate and sign multisig transactions.
 *
 * @param witnessScript The witness script from the PSBT input
 * @param bip32Derivations Array of bip32 derivation info from the PSBT
 * @param xpubMap Optional map of fingerprint (lowercase hex) to xpub string for multisig
 * @internal Exported for testing
 */
export function buildTrezorMultisig(
  witnessScript: Buffer | undefined,
  bip32Derivations: Array<{ pubkey: Buffer; path: string; masterFingerprint: Buffer }>,
  xpubMap?: Record<string, string>
): TrezorMultisig | undefined {
  if (!witnessScript || witnessScript.length === 0) {
    return undefined;
  }

  // Log xpubMap for debugging - show fingerprint comparison to diagnose mismatch
  const psbtFingerprints = bip32Derivations.map(d => d.masterFingerprint.toString('hex').toLowerCase());
  const xpubFingerprints = xpubMap ? Object.keys(xpubMap) : [];
  const matchingFingerprints = psbtFingerprints.filter(fp => xpubFingerprints.includes(fp));
  const missingInXpubMap = psbtFingerprints.filter(fp => !xpubFingerprints.includes(fp));

  log.info('buildTrezorMultisig called', {
    hasXpubMap: !!xpubMap,
    xpubMapFingerprints: xpubFingerprints,
    psbtFingerprints: psbtFingerprints,
    matchingFingerprints: matchingFingerprints,
    missingInXpubMap: missingInXpubMap,
    allMatch: missingInXpubMap.length === 0,
  });

  try {
    // Parse m-of-n from witnessScript
    // Format: OP_M <pubkey1> <pubkey2> ... OP_N OP_CHECKMULTISIG
    // OP_1 through OP_16 are 0x51 through 0x60
    const firstByte = witnessScript[0];
    const lastBeforeOpMulti = witnessScript[witnessScript.length - 2];

    const m = firstByte - 0x50;
    const n = lastBeforeOpMulti - 0x50;

    // Validate m and n are reasonable
    if (m < 1 || m > 16 || n < 1 || n > 16 || m > n) {
      return undefined;
    }

    // Sort derivations by pubkey to match sortedmulti order
    const sortedDerivations = [...bip32Derivations].sort((a, b) =>
      Buffer.compare(a.pubkey, b.pubkey)
    );

    // Build pubkeys array
    const pubkeys: TrezorMultisigPubkey[] = sortedDerivations.map(deriv => {
      // Extract child path (last 2 components: change/index)
      const pathParts = deriv.path.replace(/^m\//, '').split('/');
      const childPath = pathParts.slice(-2).map(p => {
        const hardened = p.endsWith("'") || p.endsWith('h');
        const index = parseInt(p.replace(/['h]/g, ''), 10);
        return hardened ? index + 0x80000000 : index;
      });

      // Try to find xpub by fingerprint - Trezor requires xpub (base58) for multisig, not raw pubkey
      const fingerprint = deriv.masterFingerprint.toString('hex').toLowerCase();
      const rawXpub = xpubMap?.[fingerprint];

      if (rawXpub) {
        // Trezor only accepts standard xpub/tpub format, not SLIP-132 variants (Zpub, ypub, etc.)
        // Convert any non-standard format to standard xpub
        const xpub = convertToStandardXpub(rawXpub);
        log.debug('Using xpub for multisig node', { fingerprint, rawXpubPrefix: rawXpub.substring(0, 15), xpubPrefix: xpub.substring(0, 15) });
        return {
          node: xpub,
          address_n: childPath,
        };
      }

      // Fallback to raw pubkey (will fail for Trezor but kept for compatibility)
      log.warn('No xpub found for fingerprint, using raw pubkey (may fail)', { fingerprint });
      return {
        node: deriv.pubkey.toString('hex'),
        address_n: childPath,
      };
    });

    // Initialize empty signatures array
    const signatures = sortedDerivations.map(() => '');

    return { pubkeys, signatures, m };
  } catch (error) {
    log.warn('Failed to parse multisig structure from witnessScript', { error });
    return undefined;
  }
}

/**
 * Check if PSBT input is a multisig input
 */
export function isMultisigInput(input: PsbtInputLike): boolean {
  return !!(
    input.witnessScript ||
    input.redeemScript ||
    (input.bip32Derivation && input.bip32Derivation.length > 1)
  );
}
