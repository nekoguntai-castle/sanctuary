import { beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => ({
  axiosGet: vi.fn(),
  nodeConfig: {
    findFirst: vi.fn(),
  },
}));

vi.mock('axios', () => ({
  default: {
    get: (...args: any[]) => hoisted.axiosGet(...args),
  },
}));

vi.mock('../../../../src/models/prisma', () => ({
  __esModule: true,
  default: {
    nodeConfig: hoisted.nodeConfig,
  },
}));

vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('../../../src/utils/errors', () => ({
  getErrorMessage: (err: unknown) => (err instanceof Error ? err.message : String(err)),
}));

import {
  getRecentBlocks,
  getMempoolInfo,
  getRecommendedFees,
  getBlock,
  getBlockAtHeight,
  getTipHeight,
  getProjectedMempoolBlocks,
  getBlocksAndMempool,
} from '../../../../src/services/bitcoin/mempool';
import { formatConfirmedBlocks } from '../../../../src/services/bitcoin/mempool/formatting';
import type { MempoolBlock } from '../../../../src/services/bitcoin/mempool/types';
import { DEFAULT_NODE_MEMPOOL_ESTIMATOR } from '@sanctuary/shared/constants/nodeConfig';
import { registerMempoolDashboardFormattingTests } from './mempool.dashboard-formatting.contracts';

const mockBlocks = (timestamp: number): MempoolBlock[] => ([
  {
    id: 'b1',
    height: 100,
    version: 1,
    timestamp,
    tx_count: 2000,
    size: 1000000,
    weight: 4000000,
    merkle_root: 'm',
    previousblockhash: 'p',
    medianFee: 0,
    feeRange: [1, 2, 3, 4, 5],
    extras: {
      medianFee: 0,
      feeRange: [1, 2, 3, 4, 5],
      reward: 0,
      totalFees: 100000,
    },
  },
  {
    id: 'b2',
    height: 99,
    version: 1,
    timestamp: timestamp - 600,
    tx_count: 1500,
    size: 900000,
    weight: 3600000,
    merkle_root: 'm2',
    previousblockhash: 'p2',
    medianFee: 10,
    feeRange: [10, 20],
    extras: {
      medianFee: 10,
      feeRange: [10, 20],
      reward: 0,
      totalFees: 200000,
    },
  },
]);

describe('mempool service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.nodeConfig.findFirst.mockResolvedValue(null);
  });

  it('uses feeEstimatorUrl when configured', async () => {
    hoisted.nodeConfig.findFirst.mockResolvedValue({
      isDefault: true,
      feeEstimatorUrl: 'https://mempool.custom/',
    });
    hoisted.axiosGet.mockResolvedValue({ data: mockBlocks(1000) });

    await getRecentBlocks(1);

    expect(hoisted.axiosGet).toHaveBeenCalledWith(
      'https://mempool.custom/api/v1/blocks',
      expect.objectContaining({ timeout: 3000 })
    );
  });

  it('passes request abort signals through mempool endpoint calls', async () => {
    const controller = new AbortController();
    hoisted.axiosGet.mockResolvedValue({ data: mockBlocks(1000) });

    await getRecentBlocks(1, 'mainnet', { signal: controller.signal });

    expect(hoisted.axiosGet).toHaveBeenCalledWith(
      'https://mempool.space/api/v1/blocks',
      expect.objectContaining({
        timeout: 3000,
        signal: controller.signal,
      }),
    );
  });

  it('keeps feeEstimatorUrl unchanged when it already includes /api', async () => {
    hoisted.nodeConfig.findFirst.mockResolvedValue({
      isDefault: true,
      feeEstimatorUrl: 'https://mempool.custom/api',
    });
    hoisted.axiosGet.mockResolvedValue({ data: mockBlocks(1000) });

    await getRecentBlocks(1);

    expect(hoisted.axiosGet).toHaveBeenCalledWith(
      'https://mempool.custom/api/v1/blocks',
      expect.objectContaining({ timeout: 3000 })
    );
  });

  it('uses the public testnet3 mempool API for testnet3 visualization', async () => {
    hoisted.nodeConfig.findFirst.mockResolvedValue({
      isDefault: true,
      feeEstimatorUrl: 'https://mempool.custom/',
    });
    hoisted.axiosGet.mockResolvedValue({ data: mockBlocks(1000) });

    await getRecentBlocks(1, 'testnet3');

    expect(hoisted.axiosGet).toHaveBeenCalledWith(
      'https://mempool.space/testnet/api/v1/blocks',
      expect.objectContaining({ timeout: 3000 })
    );
    expect(hoisted.nodeConfig.findFirst).toHaveBeenCalledTimes(1);
  });

  it('uses the public testnet4 mempool API separately from testnet3', async () => {
    hoisted.nodeConfig.findFirst.mockResolvedValue({
      isDefault: true,
      feeEstimatorUrl: 'https://mempool.custom/',
    });
    hoisted.axiosGet.mockResolvedValue({ data: mockBlocks(1000) });

    await getRecentBlocks(1, 'testnet4');

    expect(hoisted.axiosGet).toHaveBeenCalledWith(
      'https://mempool.space/testnet4/api/v1/blocks',
      expect.objectContaining({ timeout: 3000 })
    );
    expect(hoisted.nodeConfig.findFirst).toHaveBeenCalledTimes(1);
  });

  it('uses configured testnet4 fee estimator URL separately from mainnet', async () => {
    hoisted.nodeConfig.findFirst.mockResolvedValue({
      isDefault: true,
      feeEstimatorUrl: 'https://mempool.custom/',
      testnet4FeeEstimatorUrl: 'https://testnet4-fees.example/base/',
    });
    hoisted.axiosGet.mockResolvedValue({ data: mockBlocks(1000) });

    await getRecentBlocks(1, 'testnet4');

    expect(hoisted.axiosGet).toHaveBeenCalledWith(
      'https://testnet4-fees.example/base/api/v1/blocks',
      expect.objectContaining({ timeout: 3000 })
    );
  });

  it('uses configured signet explorer URL when fee estimator URL is unset', async () => {
    hoisted.nodeConfig.findFirst.mockResolvedValue({
      isDefault: true,
      signetExplorerUrl: 'https://signet-explorer.example',
    });
    hoisted.axiosGet.mockResolvedValue({ data: mockBlocks(1000) });

    await getRecentBlocks(1, 'signet');

    expect(hoisted.axiosGet).toHaveBeenCalledWith(
      'https://signet-explorer.example/api/v1/blocks',
      expect.objectContaining({ timeout: 3000 })
    );
  });

  it('clamps future block timestamps to zero minutes ago', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2025-01-01T00:00:00Z'));

      const [block] = formatConfirmedBlocks([
        {
          ...mockBlocks(1735689900)[0],
          timestamp: 1735689900,
        },
      ]);

      expect(block.time).toBe('0m ago');
    } finally {
      vi.useRealTimers();
    }
  });

  it('uses explorerUrl when feeEstimatorUrl is missing', async () => {
    hoisted.nodeConfig.findFirst.mockResolvedValue({
      isDefault: true,
      explorerUrl: 'https://explorer.example',
    });
    hoisted.axiosGet.mockResolvedValue({ data: mockBlocks(1000) });

    await getRecentBlocks(1);

    expect(hoisted.axiosGet).toHaveBeenCalledWith(
      'https://explorer.example/api/v1/blocks',
      expect.objectContaining({ timeout: 3000 })
    );
  });

  it('derives fee estimates from projected blocks when available', async () => {
    hoisted.axiosGet.mockResolvedValueOnce({
      data: [
        { medianFee: 5.56, feeRange: [1, 2], blockVSize: 1000000, totalFees: 100000, nTx: 100 },
        { medianFee: 4.44, feeRange: [1, 2], blockVSize: 1000000, totalFees: 100000, nTx: 100 },
        { medianFee: 3.33, feeRange: [1, 2], blockVSize: 1000000, totalFees: 100000, nTx: 100 },
        { medianFee: 2.22, feeRange: [0.5, 1], blockVSize: 1000000, totalFees: 100000, nTx: 100 },
      ],
    });

    const fees = await getRecommendedFees();
    expect(fees).toEqual({
      fastestFee: 5.6,
      halfHourFee: 4.4,
      hourFee: 3.3,
      economyFee: 2.2,
      minimumFee: 0.5,
    });
  });

  it('defaults projected minimum fee to 1 when last block feeRange is missing', async () => {
    hoisted.axiosGet.mockResolvedValueOnce({
      data: [
        { medianFee: 5.1, feeRange: [1, 2], blockVSize: 1000000, totalFees: 100000, nTx: 100 },
        { medianFee: 4.1, feeRange: [1, 2], blockVSize: 1000000, totalFees: 90000, nTx: 90 },
        { medianFee: 3.1, feeRange: [1, 2], blockVSize: 1000000, totalFees: 80000, nTx: 80 },
        { medianFee: 2.1, blockVSize: 1000000, totalFees: 70000, nTx: 70 },
      ],
    });

    const fees = await getRecommendedFees();
    expect(fees.minimumFee).toBe(1);
  });

  it('falls back to recommended endpoint when projected blocks fail', async () => {
    hoisted.axiosGet.mockRejectedValueOnce(new Error('no projected'));
    hoisted.axiosGet.mockResolvedValueOnce({
      data: { fastestFee: 10, halfHourFee: 8, hourFee: 6, economyFee: 4, minimumFee: 1 },
    });

    const fees = await getRecommendedFees();
    expect(fees.fastestFee).toBe(10);
    expect(hoisted.axiosGet).toHaveBeenCalledWith(
      expect.stringContaining('/v1/fees/recommended'),
      expect.any(Object)
    );
  });

  it('falls back to recommended endpoint when projected blocks are empty', async () => {
    hoisted.axiosGet.mockResolvedValueOnce({ data: [] });
    hoisted.axiosGet.mockResolvedValueOnce({
      data: { fastestFee: 11, halfHourFee: 9, hourFee: 7, economyFee: 5, minimumFee: 1 },
    });

    const fees = await getRecommendedFees();

    expect(fees).toEqual({
      fastestFee: 11,
      halfHourFee: 9,
      hourFee: 7,
      economyFee: 5,
      minimumFee: 1,
    });
  });

  it('builds dashboard blocks and mempool using simple estimator', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-01T00:10:00Z'));

    hoisted.nodeConfig.findFirst.mockResolvedValue({
      isDefault: true,
      mempoolEstimator: 'simple',
    });

    hoisted.axiosGet.mockImplementation((url: string) => {
      if (url.endsWith('/v1/blocks')) {
        const blocks = mockBlocks(1735689600);
        blocks[0].extras.totalFees = 0;
        blocks[0].extras.avgFeeRate = 0;
        return Promise.resolve({ data: blocks });
      }
      if (url.endsWith('/mempool')) {
        return Promise.resolve({ data: { count: 100, vsize: 2500000, total_fee: 5000, fee_histogram: [] } });
      }
      if (url.endsWith('/v1/fees/recommended')) {
        return Promise.resolve({
          data: { fastestFee: 10, halfHourFee: 6, hourFee: 4, economyFee: 2, minimumFee: 1 },
        });
      }
      return Promise.reject(new Error(`unexpected url ${url}`));
    });

    const result = await getBlocksAndMempool();
    expect(result.mempool.length).toBeGreaterThan(0);
    expect(result.blocks.length).toBe(2);
    expect(result.mempoolInfo.size).toBeCloseTo(2.5, 2);

    vi.useRealTimers();
  });

  it('handles simple estimator branches with tiny mempool and old confirmed blocks', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-01T03:00:00Z'));

    hoisted.nodeConfig.findFirst.mockResolvedValue({
      isDefault: true,
      mempoolEstimator: 'simple',
    });

    const blocks = [
      {
        id: 'old',
        height: 100,
        version: 1,
        timestamp: 1735686000, // 2025-01-01T00:00:00Z
        tx_count: 1234,
        size: 0,
        weight: 0,
        merkle_root: 'm',
        previousblockhash: 'p',
        medianFee: 3,
        feeRange: [3],
        extras: {},
      },
    ];

    hoisted.axiosGet.mockImplementation((url: string) => {
      if (url.endsWith('/v1/blocks')) {
        return Promise.resolve({ data: blocks });
      }
      if (url.endsWith('/mempool')) {
        return Promise.resolve({ data: { count: 10, vsize: 0, total_fee: 50, fee_histogram: [] } });
      }
      if (url.endsWith('/v1/fees/recommended')) {
        return Promise.resolve({
          data: { fastestFee: 10, halfHourFee: 7, hourFee: 5, economyFee: 2, minimumFee: 1 },
        });
      }
      return Promise.reject(new Error(`unexpected url ${url}`));
    });

    const result = await getBlocksAndMempool();

    expect(result.mempool).toHaveLength(0);
    expect(result.blocks[0].avgFeeRate).toBe(0);
    expect(result.blocks[0].feeRange).toBe('40.00-200.00 sat/vB');
    expect(result.blocks[0].time).toContain('h ago');

    vi.useRealTimers();
  });

  it('builds dashboard blocks using projected mempool data', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-01T00:10:00Z'));

    hoisted.nodeConfig.findFirst.mockResolvedValue({
      isDefault: true,
      mempoolEstimator: DEFAULT_NODE_MEMPOOL_ESTIMATOR,
    });

    hoisted.axiosGet.mockImplementation((url: string) => {
      if (url.endsWith('/v1/blocks')) {
        return Promise.resolve({ data: mockBlocks(1735689600) });
      }
      if (url.endsWith('/mempool')) {
        return Promise.resolve({ data: { count: 100, vsize: 2500000, total_fee: 5000, fee_histogram: [] } });
      }
      if (url.endsWith('/v1/fees/mempool-blocks')) {
        return Promise.resolve({
          data: [
            { blockVSize: 1000000, totalFees: 100000, medianFee: 10, feeRange: [5, 15], nTx: 200 },
            { blockVSize: 1000000, totalFees: 90000, medianFee: 8, feeRange: [4, 12], nTx: 180 },
            { blockVSize: 1000000, totalFees: 80000, medianFee: 6, feeRange: [3, 10], nTx: 160 },
            { blockVSize: 2000000, totalFees: 50000, medianFee: 2, feeRange: [1, 3], nTx: 100 },
          ],
        });
      }
      if (url.endsWith('/v1/fees/recommended')) {
        return Promise.resolve({
          data: { fastestFee: 10, halfHourFee: 8, hourFee: 6, economyFee: 2, minimumFee: 1 },
        });
      }
      return Promise.reject(new Error(`unexpected url ${url}`));
    });

    const result = await getBlocksAndMempool();
    expect(result.mempool[0].height).toBe('+3');
    expect(result.mempool[result.mempool.length - 1].height).toBe('Next');
    expect(result.queuedBlocksSummary?.blockCount).toBeGreaterThan(0);
    expect(result.blocks[0].medianFee).toBe(0.1);

    vi.useRealTimers();
  });

  it('formats projected blocks with low fees, zero vsize, and decimal queued summary', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-01T00:10:00Z'));

    hoisted.nodeConfig.findFirst.mockResolvedValue({
      isDefault: true,
      mempoolEstimator: DEFAULT_NODE_MEMPOOL_ESTIMATOR,
    });

    hoisted.axiosGet.mockImplementation((url: string) => {
      if (url.endsWith('/v1/blocks')) {
        return Promise.resolve({ data: mockBlocks(1735689600) });
      }
      if (url.endsWith('/mempool')) {
        return Promise.resolve({ data: { count: 50, vsize: 1500000, total_fee: 1000, fee_histogram: [] } });
      }
      if (url.endsWith('/v1/fees/mempool-blocks')) {
        return Promise.resolve({
          data: [
            { blockVSize: 0, totalFees: 0, medianFee: 0.5, feeRange: [0.2], nTx: 10 },
            { blockVSize: 500000, totalFees: 1000000, medianFee: 1.2, feeRange: [0.5, 2], nTx: 20 },
            { blockVSize: 1000000, totalFees: 3000000, medianFee: 4.8, feeRange: [1, 10], nTx: 30 },
            { blockVSize: 1000000, totalFees: 100000, medianFee: 0.4, feeRange: [0.1, 0.6], nTx: 40 },
          ],
        });
      }
      if (url.endsWith('/v1/fees/recommended')) {
        return Promise.resolve({
          data: { fastestFee: 10, halfHourFee: 8, hourFee: 6, economyFee: 2, minimumFee: 1 },
        });
      }
      return Promise.reject(new Error(`unexpected url ${url}`));
    });

    const result = await getBlocksAndMempool();

    expect(result.mempool).toHaveLength(3);
    expect(result.mempool[result.mempool.length - 1].medianFee).toBe(0.5);
    expect(result.mempool[result.mempool.length - 1]).toEqual(
      expect.objectContaining({ avgFeeRate: 0 })
    );
    expect(result.mempool[result.mempool.length - 1].feeRange).toBe('0.50 sat/vB');
    expect(result.queuedBlocksSummary?.averageFee).toBe(0.4);

    vi.useRealTimers();
  });

  it('falls back to default API when node config lookup fails', async () => {
    hoisted.nodeConfig.findFirst.mockRejectedValueOnce(new Error('db unavailable'));
    hoisted.axiosGet.mockResolvedValue({ data: mockBlocks(1000) });

    await getRecentBlocks(1);

    expect(hoisted.axiosGet).toHaveBeenCalledWith(
      'https://mempool.space/api/v1/blocks',
      expect.objectContaining({ timeout: 3000 })
    );
  });

  it('throws when recent block fetch fails', async () => {
    hoisted.axiosGet.mockRejectedValueOnce(new Error('network down'));

    await expect(getRecentBlocks()).rejects.toThrow('Failed to fetch recent blocks from mempool.space');
  });

  it('fetches mempool info and throws on failure', async () => {
    hoisted.axiosGet.mockResolvedValueOnce({
      data: { count: 123, vsize: 9999, total_fee: 42, fee_histogram: [] },
    });
    await expect(getMempoolInfo()).resolves.toEqual({
      count: 123,
      vsize: 9999,
      total_fee: 42,
      fee_histogram: [],
    });

    hoisted.axiosGet.mockRejectedValueOnce(new Error('timeout'));
    await expect(getMempoolInfo()).rejects.toThrow('Failed to fetch mempool info from mempool.space');
  });

  it('throws when both projected and recommended fee endpoints fail', async () => {
    hoisted.axiosGet.mockRejectedValueOnce(new Error('projected down'));
    hoisted.axiosGet.mockRejectedValueOnce(new Error('recommended down'));

    await expect(getRecommendedFees()).rejects.toThrow('Failed to fetch fee estimates from mempool.space');
  });

  it('fetches block and height endpoints and surfaces failures', async () => {
    hoisted.axiosGet.mockResolvedValueOnce({ data: { id: 'abc', height: 100 } });
    await expect(getBlock('abc')).resolves.toMatchObject({ id: 'abc' });

    hoisted.axiosGet.mockRejectedValueOnce(new Error('block err'));
    await expect(getBlock('def')).rejects.toThrow('Failed to fetch block from mempool.space');

    hoisted.axiosGet.mockResolvedValueOnce({ data: 'hash-at-height' });
    await expect(getBlockAtHeight(100)).resolves.toBe('hash-at-height');

    hoisted.axiosGet.mockRejectedValueOnce(new Error('height err'));
    await expect(getBlockAtHeight(101)).rejects.toThrow('Failed to fetch block at height from mempool.space');

    hoisted.axiosGet.mockResolvedValueOnce({ data: 880000 });
    await expect(getTipHeight()).resolves.toBe(880000);

    hoisted.axiosGet.mockRejectedValueOnce(new Error('tip err'));
    await expect(getTipHeight()).rejects.toThrow('Failed to fetch tip height from mempool.space');
  });

  it('fetches projected mempool blocks and handles endpoint errors', async () => {
    hoisted.axiosGet.mockResolvedValueOnce({ data: [{ blockVSize: 1000, totalFees: 100, medianFee: 1, feeRange: [1], nTx: 1 }] });
    await expect(getProjectedMempoolBlocks()).resolves.toHaveLength(1);

    hoisted.axiosGet.mockRejectedValueOnce(new Error('projected err'));
    await expect(getProjectedMempoolBlocks()).rejects.toThrow('Failed to fetch projected mempool blocks from mempool.space');
  });

  it('falls back from projected API to simple estimator and computes queued summary branches', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-01T00:10:00Z'));

    hoisted.nodeConfig.findFirst.mockResolvedValue({
      isDefault: true,
      mempoolEstimator: DEFAULT_NODE_MEMPOOL_ESTIMATOR,
    });

    const blocks = mockBlocks(1735689600).map((block) => ({
      ...block,
      extras: { ...block.extras },
    }));
    blocks[0].extras.medianFee = 0;
    blocks[0].extras.feeRange = [];
    blocks[0].extras.avgFeeRate = 3;
    blocks[1].extras.medianFee = 0;
    blocks[1].extras.feeRange = [7];
    blocks[1].extras.avgFeeRate = 0;
    blocks.push({
      ...blocks[1],
      id: 'b3',
      height: 98,
      extras: {
        ...blocks[1].extras,
        medianFee: 0,
        feeRange: [],
        avgFeeRate: 0,
      },
      medianFee: 0,
      feeRange: [],
    });

    hoisted.axiosGet.mockImplementation((url: string) => {
      if (url.endsWith('/v1/blocks')) {
        return Promise.resolve({ data: blocks });
      }
      if (url.endsWith('/mempool')) {
        return Promise.resolve({ data: { count: 300, vsize: 5000000, total_fee: 10000, fee_histogram: [] } });
      }
      if (url.endsWith('/v1/fees/mempool-blocks')) {
        return Promise.reject(new Error('projected API down'));
      }
      if (url.endsWith('/v1/fees/recommended')) {
        return Promise.resolve({
          data: { fastestFee: 12, halfHourFee: 8, hourFee: 5, economyFee: 2, minimumFee: 1 },
        });
      }
      return Promise.reject(new Error(`unexpected url ${url}`));
    });

    const result = await getBlocksAndMempool();

    expect(result.mempool.length).toBe(3);
    expect(result.queuedBlocksSummary).toEqual(
      expect.objectContaining({
        blockCount: 2,
      })
    );
    expect(result.blocks[0].medianFee).toBe(3);
    expect(result.blocks[1].medianFee).toBe(7);
    expect(result.blocks[2].medianFee).toBe(1);

    vi.useRealTimers();
  });

  it('defaults estimator mode when estimator config lookup throws', async () => {
    hoisted.nodeConfig.findFirst.mockRejectedValue(new Error('config read failed'));

    hoisted.axiosGet.mockImplementation((url: string) => {
      if (url.endsWith('/v1/blocks')) {
        return Promise.resolve({ data: mockBlocks(1735689600) });
      }
      if (url.endsWith('/mempool')) {
        return Promise.resolve({ data: { count: 200, vsize: 1800000, total_fee: 4000, fee_histogram: [] } });
      }
      if (url.endsWith('/v1/fees/mempool-blocks')) {
        return Promise.resolve({
          data: [{ blockVSize: 1000000, totalFees: 100000, medianFee: 10, feeRange: [5, 15], nTx: 200 }],
        });
      }
      if (url.endsWith('/v1/fees/recommended')) {
        return Promise.resolve({
          data: { fastestFee: 10, halfHourFee: 8, hourFee: 6, economyFee: 2, minimumFee: 1 },
        });
      }
      return Promise.reject(new Error(`unexpected url ${url}`));
    });

    const result = await getBlocksAndMempool();
    expect(result.mempool.length).toBeGreaterThan(0);
  });

  it('defaults estimator mode to mempool_space when config has no estimator value', async () => {
    hoisted.nodeConfig.findFirst.mockResolvedValue({
      isDefault: true,
    });

    hoisted.axiosGet.mockImplementation((url: string) => {
      if (url.endsWith('/v1/blocks')) {
        return Promise.resolve({ data: mockBlocks(1735689600) });
      }
      if (url.endsWith('/mempool')) {
        return Promise.resolve({ data: { count: 80, vsize: 1200000, total_fee: 1200, fee_histogram: [] } });
      }
      if (url.endsWith('/v1/fees/mempool-blocks')) {
        return Promise.resolve({
          data: [{ blockVSize: 1000000, totalFees: 100000, medianFee: 9, feeRange: [4, 12], nTx: 120 }],
        });
      }
      if (url.endsWith('/v1/fees/recommended')) {
        return Promise.resolve({
          data: { fastestFee: 9, halfHourFee: 7, hourFee: 5, economyFee: 3, minimumFee: 1 },
        });
      }
      return Promise.reject(new Error(`unexpected url ${url}`));
    });

    const result = await getBlocksAndMempool();
    expect(result.mempool.length).toBeGreaterThan(0);
  });

  registerMempoolDashboardFormattingTests({
    getBlocksAndMempool,
    hoisted,
    mockBlocks,
  });
});
