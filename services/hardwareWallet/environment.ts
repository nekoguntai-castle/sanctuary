/**
 * Lightweight environment checks for hardware wallet support.
 *
 * This module intentionally has no adapter/runtime imports so UI components can
 * safely use these checks without loading heavy hardware libraries.
 */

/**
 * Check if WebUSB is supported in this browser.
 */
export const isWebUSBSupported = (): boolean => {
  return typeof navigator !== 'undefined' && 'usb' in navigator;
};

/**
 * Check if we're in a secure context (HTTPS or localhost).
 */
export const isSecureContext = (): boolean => {
  return typeof window !== 'undefined' && window.isSecureContext;
};

/**
 * Check if hardware wallet integration is supported.
 */
export const isHardwareWalletSupported = (): boolean => {
  return isWebUSBSupported() && isSecureContext();
};
