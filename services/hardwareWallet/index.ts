/**
 * Hardware Wallet Integration
 *
 * Main entry point for hardware wallet functionality.
 * Provides a pre-configured service instance with all adapters registered.
 *
 * Usage:
 *   import { hardwareWalletService, isHardwareWalletSupported } from '../services/hardwareWallet';
 *
 *   // Connect to a device
 *   await hardwareWalletService.connect('ledger');
 *
 *   // Sign a PSBT
 *   const result = await hardwareWalletService.signPSBT({ psbt, inputPaths });
 *
 * To add a new device type:
 *   1. Create adapter in ./adapters/mydevice.ts implementing DeviceAdapter
 *   2. Export from ./adapters/index.ts
 *   3. Register below: service.registerAdapter(new MyDeviceAdapter())
 */

// Re-export types
export type {
  DeviceType,
  DeviceAdapter,
  HardwareWalletDevice,
  PSBTSignRequest,
  PSBTSignResponse,
  TransactionForSigning,
  XpubResult,
} from './types';

// Re-export adapters
export { LedgerAdapter, TrezorAdapter, BitBoxAdapter, JadeAdapter } from './adapters';

// Re-export service class
export { HardwareWalletService, createHardwareWalletService } from './service';
export {
  isWebUSBSupported,
  isSecureContext,
  isHardwareWalletSupported,
} from './environment';

// Import for setup
import { HardwareWalletService } from './service';
import { LedgerAdapter } from './adapters/ledger';
import { TrezorAdapter } from './adapters/trezor';
import { BitBoxAdapter } from './adapters/bitbox';
import { JadeAdapter } from './adapters/jade';

/**
 * Get list of previously authorized devices
 * Backward compatibility function
 */
export const getConnectedDevices = async (): Promise<import('./types').HardwareWalletDevice[]> => {
  return hardwareWalletService.getDevices();
};

/**
 * Pre-configured service instance with all adapters registered
 *
 * Supported devices:
 * - Ledger (Nano S, Nano X, Nano S Plus, Stax, Flex) via WebUSB
 * - Trezor (Model One, Model T, Safe 3/5/7) via Trezor Connect (requires Trezor Suite)
 * - BitBox02 (Multi, Bitcoin-only) via WebHID
 * - Blockstream Jade (Jade, Jade Plus) via WebSerial
 *
 * All devices require HTTPS (secure context) for USB connectivity.
 *
 * Adding new devices:
 * 1. Create an adapter class implementing DeviceAdapter interface
 * 2. Register it: hardwareWalletService.registerAdapter(new MyAdapter())
 */
const createDefaultService = (): HardwareWalletService => {
  const service = new HardwareWalletService();

  // Register built-in adapters
  service.registerAdapter(new LedgerAdapter());
  service.registerAdapter(new TrezorAdapter());
  service.registerAdapter(new BitBoxAdapter());
  service.registerAdapter(new JadeAdapter());

  // Future adapters can be added here:
  // service.registerAdapter(new ColdcardAdapter());

  return service;
};

/**
 * Singleton service instance
 */
export const hardwareWalletService = createDefaultService();
