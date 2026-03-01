import { CryptoOutput, CryptoHDKey, CryptoAccount } from '@keystonehq/bc-ur-registry';
import { parseDeviceJson } from '../../../services/deviceParsers';
import { createLogger } from '../../../utils/logger';

const log = createLogger('DeviceDetail');

/**
 * Normalize a derivation path to standard format
 */
export const normalizeDerivationPath = (path: string): string => {
  if (!path) return '';
  let normalized = path.trim();
  if (normalized.startsWith('M/')) {
    normalized = 'm/' + normalized.slice(2);
  } else if (!normalized.startsWith('m/')) {
    normalized = 'm/' + normalized;
  }
  normalized = normalized.replace(/(\d+)h/g, "$1'");
  return normalized;
};

/**
 * Extract fingerprint from CryptoHDKey
 */
export const extractFingerprintFromHdKey = (hdKey: CryptoHDKey): string => {
  const origin = hdKey.getOrigin();
  if (origin) {
    const sourceFingerprint = origin.getSourceFingerprint();
    if (sourceFingerprint && sourceFingerprint.length > 0) {
      return sourceFingerprint.toString('hex');
    }
  }
  try {
    const parentFp = hdKey.getParentFingerprint();
    if (parentFp && parentFp.length > 0) {
      return parentFp.toString('hex');
    }
  } catch {
    // getParentFingerprint might not exist or fail
  }
  return '';
};

/**
 * Extract xpub data from UR registry result
 */
export const extractFromUrResult = (registryType: unknown): { xpub: string; fingerprint: string; path: string } | null => {
  try {
    if (registryType instanceof CryptoHDKey) {
      const hdKey = registryType as CryptoHDKey;
      const xpub = hdKey.getBip32Key();
      const fingerprint = extractFingerprintFromHdKey(hdKey);
      const origin = hdKey.getOrigin();
      const pathComponents = origin?.getComponents() || [];
      const path = pathComponents.length > 0
        ? 'm/' + pathComponents.map((c: { getIndex: () => number; isHardened: () => boolean }) => `${c.getIndex()}${c.isHardened() ? "'" : ''}`).join('/')
        : '';
      return { xpub, fingerprint, path };
    }

    if (registryType instanceof CryptoOutput) {
      const output = registryType as CryptoOutput;
      const hdKey = output.getHDKey();
      if (hdKey) {
        const xpub = hdKey.getBip32Key();
        const fingerprint = extractFingerprintFromHdKey(hdKey);
        const origin = hdKey.getOrigin();
        const pathComponents = origin?.getComponents() || [];
        const path = pathComponents.length > 0
          ? 'm/' + pathComponents.map((c: { getIndex: () => number; isHardened: () => boolean }) => `${c.getIndex()}${c.isHardened() ? "'" : ''}`).join('/')
          : '';
        return { xpub, fingerprint, path };
      }
    }

    if (registryType instanceof CryptoAccount) {
      const account = registryType as CryptoAccount;
      const masterFingerprint = account.getMasterFingerprint()?.toString('hex') || '';
      const outputs = account.getOutputDescriptors();
      for (const output of outputs) {
        const hdKey = output.getHDKey();
        if (hdKey) {
          const xpub = hdKey.getBip32Key();
          const origin = hdKey.getOrigin();
          const pathComponents = origin?.getComponents() || [];
          const path = pathComponents.length > 0
            ? 'm/' + pathComponents.map((c: { getIndex: () => number; isHardened: () => boolean }) => `${c.getIndex()}${c.isHardened() ? "'" : ''}`).join('/')
            : '';
          if (path.includes("84'")) {
            return { xpub, fingerprint: masterFingerprint, path };
          }
        }
      }
      if (outputs.length > 0) {
        const hdKey = outputs[0].getHDKey();
        if (hdKey) {
          const xpub = hdKey.getBip32Key();
          const origin = hdKey.getOrigin();
          const pathComponents = origin?.getComponents() || [];
          const path = pathComponents.length > 0
            ? 'm/' + pathComponents.map((c: { getIndex: () => number; isHardened: () => boolean }) => `${c.getIndex()}${c.isHardened() ? "'" : ''}`).join('/')
            : '';
          return { xpub, fingerprint: masterFingerprint, path };
        }
      }
    }

    // Handle ur:bytes format
    const regType = registryType as { bytes?: Uint8Array };
    if (regType && regType.bytes instanceof Uint8Array) {
      const textDecoder = new TextDecoder('utf-8');
      const textContent = textDecoder.decode(regType.bytes);
      const result = parseDeviceJson(textContent);
      if (result && result.xpub) {
        return {
          xpub: result.xpub,
          fingerprint: result.fingerprint || '',
          path: result.derivationPath || ''
        };
      }
    }

    return null;
  } catch (err) {
    log.error('Failed to extract from UR result', { err });
    return null;
  }
};
