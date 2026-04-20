import type { QrScanResult } from './types';

type RawPsbtScanResult =
  | { kind: 'psbt'; base64: string }
  | { kind: 'decoded-non-psbt'; preview: string }
  | { kind: 'invalid-base64'; error: unknown };

export function getFirstScanContent(results: QrScanResult[] | undefined, processing: boolean) {
  if (!results || results.length === 0 || processing) {
    return null;
  }

  return results[0].rawValue;
}

/**
 * Interprets non-UR QR payloads as raw base64 PSBTs by checking the decoded
 * BIP-174 "psbt" magic prefix before accepting the scan.
 */
export function parseRawBase64PsbtScan(content: string): RawPsbtScanResult {
  try {
    const decoded = atob(content);
    if (decoded.startsWith('psbt')) {
      return { kind: 'psbt', base64: content };
    }

    return { kind: 'decoded-non-psbt', preview: decoded.substring(0, 10) };
  } catch (error) {
    return { kind: 'invalid-base64', error };
  }
}

export function invalidQrFormatMessage(content: string) {
  return `Invalid QR code format. Expected UR (ur:crypto-psbt) or base64 PSBT. Got: ${content.substring(0, 30)}...`;
}
