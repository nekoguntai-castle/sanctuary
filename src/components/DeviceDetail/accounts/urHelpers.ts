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

// Re-export UR extraction utilities from canonical location
export { extractFingerprintFromHdKey, extractFromUrResult } from '../../../utils/urDeviceDecoder';
