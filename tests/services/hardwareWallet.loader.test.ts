import { describe, expect, it, vi } from 'vitest';

describe('hardwareWallet loader', () => {
  it('caches the runtime module promise', async () => {
    vi.resetModules();
    const { loadHardwareWalletRuntime } = await import('../../src/services/hardwareWallet/loader');
    const firstModule = await loadHardwareWalletRuntime();
    const secondModule = await loadHardwareWalletRuntime();

    expect(firstModule).toBe(secondModule);
    expect(firstModule).toHaveProperty('hardwareWalletService');
  });

  it('disconnectHardwareWalletIfLoaded is a no-op before runtime is loaded', async () => {
    vi.resetModules();
    const { disconnectHardwareWalletIfLoaded } = await import('../../src/services/hardwareWallet/loader');
    expect(() => disconnectHardwareWalletIfLoaded()).not.toThrow();
  });

  it('disconnectHardwareWalletIfLoaded disconnects an already-loaded runtime and swallows disconnect errors', async () => {
    vi.resetModules();
    const {
      loadHardwareWalletRuntime,
      disconnectHardwareWalletIfLoaded,
    } = await import('../../src/services/hardwareWallet/loader');
    const runtime = await loadHardwareWalletRuntime();
    const disconnectSpy = vi.spyOn(runtime.hardwareWalletService, 'disconnect')
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('usb busy'));

    disconnectHardwareWalletIfLoaded();
    expect(disconnectSpy).toHaveBeenCalledTimes(1);

    disconnectHardwareWalletIfLoaded();
    expect(disconnectSpy).toHaveBeenCalledTimes(2);
    await Promise.resolve();
    await Promise.resolve();
  });
});
