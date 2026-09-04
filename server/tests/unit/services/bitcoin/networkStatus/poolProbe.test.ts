import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../../../src/utils/logger', () => ({
  createLogger: () => ({ debug: vi.fn(), warn: vi.fn(), info: vi.fn(), error: vi.fn() }),
}));

import { probePool } from '../../../../../src/services/bitcoin/networkStatus/poolProbe';
import type { ElectrumPool } from '../../../../../src/services/bitcoin/electrumPool/electrumPool';

function makePool(handle: {
  serverId: string;
  getServerVersion: () => Promise<{ server: string; protocol: string }>;
  getBlockHeight: () => Promise<number>;
}) {
  const release = vi.fn();
  return {
    acquire: vi.fn().mockResolvedValue({
      client: { getServerVersion: handle.getServerVersion, getBlockHeight: handle.getBlockHeight },
      serverId: handle.serverId,
      release,
    }),
    release,
  };
}

describe('probePool', () => {
  it('returns ok:true with the handle serverId on full success and releases exactly once', async () => {
    const { acquire, release } = makePool({
      serverId: 's1',
      getServerVersion: () => Promise.resolve({ server: 'X', protocol: '1.4' }),
      getBlockHeight: () => Promise.resolve(500),
    });
    const pool = { acquire } as unknown as ElectrumPool;

    const result = await probePool(pool);

    expect(result).toEqual({ ok: true, serverId: 's1', version: { server: 'X', protocol: '1.4' }, blockHeight: 500 });
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('returns ok:false and releases once when the version RPC rejects (delayed height)', async () => {
    const { acquire, release } = makePool({
      serverId: 's1',
      getServerVersion: () => Promise.reject(new Error('boom')),
      getBlockHeight: () => new Promise((resolve) => setTimeout(() => resolve(500), 5)),
    });
    const pool = { acquire } as unknown as ElectrumPool;

    const result = await probePool(pool);

    expect(result).toEqual({ ok: false, serverId: null, version: null });
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('returns ok:false and releases once when the height RPC rejects (delayed version)', async () => {
    const { acquire, release } = makePool({
      serverId: 's1',
      getServerVersion: () => new Promise((resolve) => setTimeout(() => resolve({ server: 'X', protocol: '1.4' }), 5)),
      getBlockHeight: () => Promise.reject(new Error('boom')),
    });
    const pool = { acquire } as unknown as ElectrumPool;

    const result = await probePool(pool);

    expect(result).toEqual({ ok: false, serverId: null, version: null });
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('releases exactly once and rejects when the handle client throws synchronously', async () => {
    const release = vi.fn();
    const pool = {
      acquire: vi.fn().mockResolvedValue({
        client: {
          getServerVersion: () => {
            throw new Error('synchronous boom');
          },
          getBlockHeight: () => Promise.resolve(1),
        },
        serverId: 's1',
        release,
      }),
    } as unknown as ElectrumPool;

    await expect(probePool(pool)).rejects.toThrow('synchronous boom');
    expect(release).toHaveBeenCalledTimes(1);
  });
});
