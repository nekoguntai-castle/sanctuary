import { HardwareWalletService } from './service';
import type { HardwareWalletDevice } from './types';

const service = new HardwareWalletService();

// Lazy-register adapters so route-level code-splitting can load only the
// selected hardware stack instead of bundling every adapter up front.
service.registerAdapterLoader('ledger', async () => {
  const { LedgerAdapter } = await import('./adapters/ledger');
  return new LedgerAdapter();
});

service.registerAdapterLoader('trezor', async () => {
  const { TrezorAdapter } = await import('./adapters/trezor');
  return new TrezorAdapter();
});

service.registerAdapterLoader('bitbox', async () => {
  const { BitBoxAdapter } = await import('./adapters/bitbox');
  return new BitBoxAdapter();
});

service.registerAdapterLoader('jade', async () => {
  const { JadeAdapter } = await import('./adapters/jade');
  return new JadeAdapter();
});

export const hardwareWalletService = service;

export const getConnectedDevices = async (): Promise<HardwareWalletDevice[]> => {
  return hardwareWalletService.getDevices();
};
