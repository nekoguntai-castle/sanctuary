/**
 * Device Connection Utilities
 *
 * Pure utility functions for device connection workflows.
 * Extracted from ConnectDevice.tsx for reusability and testability.
 */

import { HardwareDeviceModel } from '../api/devices';
import type { DeviceType } from '../services/hardwareWallet/types';
import { normalizeDerivationPath as sharedNormalizePath } from '@sanctuary/shared/utils/bitcoin';
import { Usb, HardDrive, QrCode } from 'lucide-react';

/**
 * Map hardware device model to device type for hardware wallet service
 */
export function getDeviceTypeFromModel(model: HardwareDeviceModel): DeviceType {
  const name = model.name.toLowerCase();
  const manufacturer = model.manufacturer.toLowerCase();

  if (manufacturer === 'trezor' || name.includes('trezor')) {
    return 'trezor';
  }
  if (manufacturer === 'ledger' || name.includes('ledger')) {
    return 'ledger';
  }
  if (manufacturer === 'coldcard' || name.includes('coldcard')) {
    return 'coldcard';
  }
  if (manufacturer === 'bitbox' || name.includes('bitbox')) {
    return 'bitbox';
  }
  if (manufacturer === 'foundation' || name.includes('passport')) {
    return 'passport';
  }
  if (manufacturer === 'blockstream' || name.includes('jade')) {
    return 'jade';
  }
  return 'unknown';
}

export const CONNECTION_METHODS = ['usb', 'sd_card', 'qr_code'] as const;
export type ConnectionMethod = (typeof CONNECTION_METHODS)[number];

export const DEVICE_CONNECTIVITY_METHODS = ['usb', 'sd_card', 'qr_code'] as const;
export type DeviceConnectivityMethod = (typeof DEVICE_CONNECTIVITY_METHODS)[number];

export function isConnectionMethod(value: string): value is ConnectionMethod {
  return (CONNECTION_METHODS as readonly string[]).includes(value);
}

export function isDeviceConnectivityMethod(value: string): value is DeviceConnectivityMethod {
  return (DEVICE_CONNECTIVITY_METHODS as readonly string[]).includes(value);
}

/**
 * Normalize derivation path notation without repairing policy evidence.
 *
 * - Ensures 'm/' prefix (case-insensitive)
 * - Converts 'h' notation to apostrophes (84h -> 84')
 *
 * @example
 * normalizeDerivationPath("M/84'/0'/0'") // => "m/84'/0'/0'"
 * normalizeDerivationPath("84/0/0") // => "m/84/0/0" (still invalid policy evidence)
 */
export function normalizeDerivationPath(path: string): string {
  if (!path) return '';

  // Use shared utility for basic normalization
  let normalized = sharedNormalizePath(path.trim());

  // Handle uppercase 'M/' prefix (shared util only handles lowercase)
  if (path.trim().startsWith('M/')) {
    normalized = sharedNormalizePath('m/' + path.trim().slice(2));
  }

  return normalized;
}

/**
 * Generate warning message for missing QR code fields
 *
 * @returns Warning message if important fields are missing, null otherwise
 */
export function generateMissingFieldsWarning(fields: {
  hasFingerprint: boolean;
  hasDerivationPath: boolean;
}): string | null {
  const missing: string[] = [];

  if (!fields.hasFingerprint) {
    missing.push('master fingerprint');
  }
  if (!fields.hasDerivationPath) {
    missing.push('derivation path');
  }

  if (missing.length === 0) return null;

  return `QR code did not contain: ${missing.join(', ')}. Please verify these fields are correct.`;
}

/** Configuration for connection method UI display */
export interface ConnectivityMethodConfig {
  icon: React.FC<{ className?: string }>;
  label: string;
  description: string;
}

/**
 * Map connectivity types to icons and labels
 * Note: Bluetooth and NFC are not currently supported for direct device communication
 */
export const connectivityConfig: Record<DeviceConnectivityMethod, ConnectivityMethodConfig> = {
  usb: { icon: Usb, label: 'USB', description: 'Connect via USB cable' },
  sd_card: { icon: HardDrive, label: 'SD Card', description: 'Import from SD card file' },
  qr_code: { icon: QrCode, label: 'QR Code', description: 'Scan QR codes' },
};

/**
 * Track which fields were extracted from QR scan
 */
export interface QrExtractedFields {
  xpub: boolean;
  fingerprint: boolean;
  derivationPath: boolean;
  label: boolean;
}

/**
 * Check if method is available based on device capabilities and security context
 *
 * @param method - Connection method to check
 * @param deviceConnectivity - Array of connectivity options from device model
 * @param isSecure - Whether we're in a secure context (HTTPS)
 * @returns true if method is available
 */
export function isMethodAvailable(
  method: ConnectionMethod,
  deviceConnectivity: string[],
  isSecure: boolean
): boolean {
  // Check if device supports this method
  if (!deviceConnectivity.includes(method)) return false;

  // USB requires secure context (HTTPS for WebUSB)
  if (method === 'usb' && !isSecure) return false;

  // QR camera scanning requires secure context
  if (method === 'qr_code' && !isSecure) return false;

  return true;
}

/**
 * Get available connection methods for a device model
 */
export function getAvailableMethods(
  deviceConnectivity: string[],
  isSecure: boolean
): ConnectionMethod[] {
  const methods: ConnectionMethod[] = [];

  // Add methods based on device connectivity
  for (const conn of deviceConnectivity) {
    if (!isDeviceConnectivityMethod(conn)) {
      continue;
    }

    if (isMethodAvailable(conn, deviceConnectivity, isSecure)) {
      methods.push(conn);
    }
  }

  return methods;
}
