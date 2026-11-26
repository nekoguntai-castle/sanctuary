import { memoizeUntilRejected } from '../../utils/memoizeUntilRejected';
import { createLogger } from '../../utils/logger';

const log = createLogger('HardwareWalletLoader');

type HardwareWalletRuntimeModule = typeof import('./runtime');

let loadedRuntime: HardwareWalletRuntimeModule | null = null;

const loadRuntimeOnce = memoizeUntilRejected(async () => {
  const runtime = await import('./runtime');
  loadedRuntime = runtime;
  return runtime;
});

export const loadHardwareWalletRuntime = (): Promise<HardwareWalletRuntimeModule> =>
  loadRuntimeOnce();

/**
 * Disconnect any active hardware wallet transport when the runtime chunk has
 * already been loaded in this tab. Does not trigger a lazy import on logout
 * for sessions that never used hardware wallets.
 */
export const disconnectHardwareWalletIfLoaded = (): void => {
  if (!loadedRuntime) return;
  void loadedRuntime.hardwareWalletService.disconnect().catch((error: unknown) => {
    log.warn('Failed to disconnect hardware wallet on session end', { error });
  });
};
