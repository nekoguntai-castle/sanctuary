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
 * @param xpubMap Exact map of fingerprint (lowercase hex) to account xpub for every cosigner
 * @internal Exported for testing
 */
export function buildTrezorMultisig(
  witnessScript: Buffer | undefined,
  bip32Derivations: Array<{
    pubkey: Uint8Array;
    path: string;
    masterFingerprint: Uint8Array;
  }>,
  xpubMap?: Record<string, string>
): TrezorMultisig | undefined {
  if (!witnessScript || witnessScript.length === 0) {
    return undefined;
  }

  // Log xpubMap for debugging - show fingerprint comparison to diagnose mismatch
  const psbtFingerprints = bip32Derivations.map(derivation => (
    Buffer.from(derivation.masterFingerprint).toString('hex').toLowerCase()
  ));
  const xpubFingerprints = xpubMap ? Object.keys(xpubMap) : [];
  const matchingFingerprints = psbtFingerprints.filter(fp => xpubFingerprints.includes(fp));
  const missingInXpubMap = [...new Set(psbtFingerprints.filter(fingerprint => {
    const xpub = xpubMap?.[fingerprint];
    return typeof xpub !== 'string' || xpub.length === 0 || xpub !== xpub.trim();
  }))].sort();

  log.info('buildTrezorMultisig called', {
    hasXpubMap: !!xpubMap,
    xpubMapFingerprints: xpubFingerprints,
    psbtFingerprints: psbtFingerprints,
    matchingFingerprints: matchingFingerprints,
    missingInXpubMap: missingInXpubMap,
    allMatch: missingInXpubMap.length === 0,
  });

  if (missingInXpubMap.length > 0) {
    throw new Error(
      `Trezor multisig signing is missing account xpub evidence for fingerprints: ${missingInXpubMap.join(', ')}`,
    );
  }

  // Parse m-of-n from the canonical script envelope before building any device payload.
  const m = witnessScript[0] - 0x50;
  const n = witnessScript[witnessScript.length - 2] - 0x50;
  if (m < 1 || m > 16 || n < 1 || n > 16 || m > n) {
    return undefined;
  }
  if (bip32Derivations.length !== n || new Set(psbtFingerprints).size !== n) {
    throw new Error(
      `Trezor multisig signing requires exactly ${n} distinct signer derivations`,
    );
  }

  try {
    // Sort derivations by pubkey to match sortedmulti order
    const sortedDerivations = [...bip32Derivations].sort((a, b) =>
      Buffer.compare(Buffer.from(a.pubkey), Buffer.from(b.pubkey))
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

      // The preflight above proves exact account-xpub coverage for every fingerprint.
      const fingerprint = Buffer.from(deriv.masterFingerprint).toString('hex').toLowerCase();
      const rawXpub = xpubMap![fingerprint];
      // Trezor accepts standard xpub/tpub nodes, not SLIP-132 display variants.
      const xpub = convertToStandardXpub(rawXpub);
      log.debug('Using xpub for multisig node', {
        fingerprint,
        rawXpubPrefix: rawXpub.substring(0, 15),
        xpubPrefix: xpub.substring(0, 15),
      });
      return {
        node: xpub,
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
