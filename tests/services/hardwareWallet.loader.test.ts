import { describe,expect,it } from 'vitest';
import { loadHardwareWalletRuntime } from '../../src/services/hardwareWallet/loader';

describe('hardwareWallet loader', () => {
  it('caches the runtime module promise', async () => {
    const firstModule = await loadHardwareWalletRuntime();
    const secondModule = await loadHardwareWalletRuntime();

    expect(firstModule).toBe(secondModule);
    expect(firstModule).toHaveProperty('hardwareWalletService');
  });
});
