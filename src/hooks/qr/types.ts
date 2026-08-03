/**
 * QR Scanner Types
 *
 * Shared types and interfaces for the QR scanner hook and its decoder modules.
 */

import { DeviceAccount } from '../../services/deviceParsers';
import { QrExtractedFields } from '../../utils/deviceConnection';

/** Result of a successful QR scan */
export interface QrScanResult {
  /** Extended public key */
  xpub: string;
  /** Master fingerprint (may be empty) */
  fingerprint: string;
  /** Derivation path (may be empty) */
  derivationPath: string;
  /** Device label (may be empty) */
  label?: string;
  /** Multiple accounts if available */
  accounts?: DeviceAccount[];
  /** Which fields were extracted from QR */
  extractedFields: QrExtractedFields;
  /** Warning message for missing fields */
  warning: string | null;
}

export interface UseQrScannerState {
  /** QR input mode */
  qrMode: 'camera' | 'file';
  /** Set QR input mode */
  setQrMode: (mode: 'camera' | 'file') => void;
  /** Whether camera is active */
  cameraActive: boolean;
  /** Set camera active state */
  setCameraActive: (active: boolean) => void;
  /** Camera error message */
  cameraError: string | null;
  /** Progress for multi-part UR codes (0-100) */
  urProgress: number;
  /** Whether currently processing a scan */
  scanning: boolean;
  /** Result of successful scan */
  scanResult: QrScanResult | null;
  /** Error message from failed scan */
  error: string | null;
  /** Handle a scanned QR code */
  handleQrScan: (result: { rawValue: string }[]) => void;
  /** Handle camera error */
  handleCameraError: (error: unknown) => void;
  /** Handle file content (from file upload) */
  handleFileContent: (content: string) => void;
  /** Reset all scanner state */
  reset: () => void;
  /** Close camera and clear progress */
  stopCamera: () => void;
}

/** Callbacks provided by the main hook for decoder modules to update state */
export interface DecoderCallbacks {
  setUrProgress: (progress: number) => void;
  setCameraActive: (active: boolean) => void;
  setScanning: (scanning: boolean) => void;
  setError: (error: string | null) => void;
  setScanResult: (result: QrScanResult | null) => void;
  createScanResult: (
    xpub: string,
    fingerprint: string,
    path: string,
    label?: string,
    accounts?: DeviceAccount[]
  ) => QrScanResult;
}
