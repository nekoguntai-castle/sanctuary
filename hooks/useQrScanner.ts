/**
 * QR Scanner Hook - Re-export barrel
 *
 * This file preserves backward compatibility for existing imports.
 * The implementation has been modularized into hooks/qr/.
 */

export { useQrScanner } from './qr/useQrScanner';
export type { QrScanResult, UseQrScannerState } from './qr/types';
