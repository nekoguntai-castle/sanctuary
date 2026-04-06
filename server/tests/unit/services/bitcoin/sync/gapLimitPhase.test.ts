const hoisted = vi.hoisted(() => ({
  ensureGapLimit: vi.fn(),
}));

vi.mock('../../../../../src/services/bitcoin/sync/addressDiscovery', () => ({
  ensureGapLimit: (...args: any[]) => hoisted.ensureGapLimit(...args),
}));

vi.mock('../../../../../src/websocket/notifications', () => ({
  walletLog: vi.fn(),
}));

vi.mock('../../../../../src/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import { describe, expect, it, beforeEach } from 'vitest';
import { createTestContext } from '../../../../../src/services/bitcoin/sync/context';
import { gapLimitPhase } from '../../../../../src/services/bitcoin/sync/phases/gapLimit';
import { walletLog } from '../../../../../src/websocket/notifications';

describe('gapLimitPhase', () => {
  beforeEach(() => {
    hoisted.ensureGapLimit.mockReset();
    vi.mocked(walletLog).mockReset();
  });

  it('returns unchanged context when no new addresses are needed', async () => {
    hoisted.ensureGapLimit.mockResolvedValue([]);
    const client = { getAddressHistoryBatch: vi.fn() };
    const ctx = createTestContext({
      walletId: 'wallet-gap-none',
      client: client as any,
    });

    const result = await gapLimitPhase(ctx);

    expect(result).toBe(ctx);
    expect(result.stats.newAddressesGenerated).toBe(0);
    expect(client.getAddressHistoryBatch).not.toHaveBeenCalled();
  });

  it('stores generated addresses and stats when scan finds no history', async () => {
    const generated = [
      { address: 'tb1qnew000000000000000000000000000000000001', derivationPath: "m/84'/1'/0'/0/20" },
      { address: 'tb1qnew000000000000000000000000000000000002', derivationPath: "m/84'/1'/0'/0/21" },
    ];
    hoisted.ensureGapLimit.mockResolvedValue(generated);
    const client = {
      getAddressHistoryBatch: vi.fn().mockResolvedValue(
        new Map([
          [generated[0].address, []],
          [generated[1].address, []],
        ])
      ),
    };
    const ctx = createTestContext({
      walletId: 'wallet-gap-scan-empty',
      client: client as any,
    });

    const result = await gapLimitPhase(ctx);

    expect(result.newAddresses).toEqual(generated);
    expect(result.stats.newAddressesGenerated).toBe(2);
    expect(client.getAddressHistoryBatch).toHaveBeenCalledWith(generated.map(a => a.address));
    expect(vi.mocked(walletLog)).toHaveBeenCalledWith(
      'wallet-gap-scan-empty',
      'info',
      'BLOCKCHAIN',
      expect.stringContaining('Scanning 2 newly generated addresses')
    );
    expect(vi.mocked(walletLog)).not.toHaveBeenCalledWith(
      'wallet-gap-scan-empty',
      'info',
      'BLOCKCHAIN',
      expect.stringContaining('re-syncing')
    );
  });

  it('emits re-sync log when generated addresses already have history', async () => {
    const generated = [
      { address: 'tb1qnew000000000000000000000000000000000003', derivationPath: "m/84'/1'/0'/0/22" },
    ];
    hoisted.ensureGapLimit.mockResolvedValue(generated);
    const client = {
      getAddressHistoryBatch: vi.fn().mockResolvedValue(
        new Map([
          [generated[0].address, [{ tx_hash: 'a'.repeat(64), height: 1 }]],
        ])
      ),
    };
    const ctx = createTestContext({
      walletId: 'wallet-gap-found',
      client: client as any,
    });

    await gapLimitPhase(ctx);

    expect(vi.mocked(walletLog)).toHaveBeenCalledWith(
      'wallet-gap-found',
      'info',
      'BLOCKCHAIN',
      expect.stringContaining('re-syncing')
    );
  });

  it('swallows generated-address scan errors and still returns context', async () => {
    const generated = [
      { address: 'tb1qnew000000000000000000000000000000000004', derivationPath: "m/84'/1'/0'/0/23" },
    ];
    hoisted.ensureGapLimit.mockResolvedValue(generated);
    const client = {
      getAddressHistoryBatch: vi.fn().mockRejectedValue(new Error('scan failed')),
    };
    const ctx = createTestContext({
      walletId: 'wallet-gap-error',
      client: client as any,
    });

    const result = await gapLimitPhase(ctx);

    expect(result.newAddresses).toEqual(generated);
    expect(result.stats.newAddressesGenerated).toBe(1);
  });
});
