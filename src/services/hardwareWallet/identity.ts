import type { XpubResult } from './types';
import {
  ExactDeviceEvidenceStringSchema,
  MasterFingerprintSchema,
} from '@sanctuary/shared/schemas/deviceIdentity';
import { parseDerivationPath } from '@sanctuary/shared/utils/bitcoin';

export class HardwareWalletIdentityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HardwareWalletIdentityError';
  }
}

/** Normalizes device-reported identity at the hardware trust boundary. */
export function normalizeMasterFingerprint(
  fingerprint: unknown,
  source = 'Hardware wallet'
): string {
  const parsed = MasterFingerprintSchema.safeParse(fingerprint);
  if (!parsed.success) {
    throw new HardwareWalletIdentityError(`${source} did not provide a valid master fingerprint`);
  }

  return parsed.data;
}

/** Proves that live device evidence belongs to the expected stored signer. */
export function requireMatchingMasterFingerprint(
  fingerprint: unknown,
  expectedFingerprint: unknown,
  source = 'Hardware wallet'
): string {
  const normalized = normalizeMasterFingerprint(fingerprint, source);
  const expected = normalizeMasterFingerprint(expectedFingerprint, 'Expected device');
  if (normalized !== expected) {
    throw new HardwareWalletIdentityError(
      `${source} fingerprint mismatch: expected ${expected}, received ${normalized}`
    );
  }

  return normalized;
}

/** Accepts only exact, recognized BIP44/49/84/86/48 account-level paths. */
export function validateAccountDerivationPath(path: unknown): string {
  const exactPath = ExactDeviceEvidenceStringSchema.safeParse(path);
  if (!exactPath.success) {
    throw new HardwareWalletIdentityError('Hardware wallet returned an invalid derivation path');
  }

  const parsed = parseDerivationPath(exactPath.data);
  if (
    !parsed.valid
    || parsed.accountPath !== parsed.normalizedPath
    || parsed.accountPurpose === 'unknown'
    || parsed.scriptType === 'unknown'
  ) {
    throw new HardwareWalletIdentityError(
      `Hardware wallet returned an invalid account derivation path: ${exactPath.data}`
    );
  }

  return exactPath.data;
}

/** Binds a device-returned xpub to the exact request path and signer identity. */
export function validateXpubResult(
  result: XpubResult,
  expectedPath: string,
  expectedFingerprint: string
): XpubResult {
  if (result.path !== expectedPath) {
    throw new HardwareWalletIdentityError(
      `Hardware wallet xpub path mismatch: requested ${expectedPath}, received ${result.path}`
    );
  }
  if (!ExactDeviceEvidenceStringSchema.safeParse(result.xpub).success) {
    throw new HardwareWalletIdentityError(`Hardware wallet returned an invalid xpub for ${expectedPath}`);
  }

  return {
    ...result,
    fingerprint: requireMatchingMasterFingerprint(
      result.fingerprint,
      expectedFingerprint,
      `Hardware wallet xpub for ${expectedPath}`
    ),
  };
}

/**
 * Validates an entire xpub batch before callers persist any account. Registration
 * has no stored identity yet; account-add supplies it and requires an exact match.
 */
export function validateXpubBatch<T extends XpubResult>(
  results: T[],
  connectedFingerprint: unknown,
  storedFingerprint?: unknown
): { fingerprint: string; results: T[] } {
  if (results.length === 0) {
    throw new HardwareWalletIdentityError('Hardware wallet did not return any xpubs');
  }

  const connected = storedFingerprint === undefined
    ? normalizeMasterFingerprint(connectedFingerprint, 'Connected hardware wallet')
    : requireMatchingMasterFingerprint(
      connectedFingerprint,
      storedFingerprint,
      'Connected hardware wallet'
    );

  const validated = results.map(result => {
    validateAccountDerivationPath(result.path);
    return validateXpubResult(result, result.path, connected) as T;
  });

  return { fingerprint: connected, results: validated };
}
