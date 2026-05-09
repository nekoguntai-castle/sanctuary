import { expect, it, vi } from "vitest";
import type { getBlocksAndMempool } from "../../../../src/services/bitcoin/mempool";

type MempoolDashboardFormattingContext = {
  getBlocksAndMempool: typeof getBlocksAndMempool;
  hoisted: {
    axiosGet: any;
    nodeConfig: {
      findFirst: any;
    };
  };
  mockBlocks: (timestamp: number) => any[];
};

export function registerMempoolDashboardFormattingTests({
  getBlocksAndMempool,
  hoisted,
  mockBlocks,
}: MempoolDashboardFormattingContext): void {
  it("handles mempool-space confirmed blocks with size fallback and high avg fee rate rounding", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2025-01-01T00:10:00Z"));

      hoisted.nodeConfig.findFirst.mockResolvedValue({
        isDefault: true,
        mempoolEstimator: "mempool_space",
      });

      const blocks = [
        {
          id: "z1",
          height: 120,
          version: 1,
          timestamp: 1735689600,
          tx_count: 1200,
          size: 0,
          weight: 0,
          merkle_root: "m1",
          previousblockhash: "p1",
          medianFee: 7,
          feeRange: [3, 9],
          extras: {
            feeRange: [3, 9],
            reward: 0,
            totalFees: 0,
          },
        },
        {
          id: "z2",
          height: 119,
          version: 1,
          timestamp: 1735689000,
          tx_count: 900,
          size: 100,
          weight: 400,
          merkle_root: "m2",
          previousblockhash: "p2",
          medianFee: 8,
          feeRange: [6, 12],
          extras: {
            medianFee: 8,
            feeRange: [6, 12],
            reward: 0,
            totalFees: 1000,
          },
        },
      ];

      hoisted.axiosGet.mockImplementation((url: string) => {
        if (url.endsWith("/v1/blocks")) {
          return Promise.resolve({ data: blocks });
        }
        if (url.endsWith("/mempool")) {
          return Promise.resolve({
            data: {
              count: 120,
              fee_histogram: [],
              total_fee: 2000,
              vsize: 1800000,
            },
          });
        }
        if (url.endsWith("/v1/fees/mempool-blocks")) {
          return Promise.resolve({
            data: [
              {
                blockVSize: 1000000,
                feeRange: [4, 12],
                medianFee: 9,
                nTx: 120,
                totalFees: 100000,
              },
            ],
          });
        }
        if (url.endsWith("/v1/fees/recommended")) {
          return Promise.resolve({
            data: {
              economyFee: 3,
              fastestFee: 9,
              halfHourFee: 7,
              hourFee: 5,
              minimumFee: 1,
            },
          });
        }
        return Promise.reject(new Error(`unexpected url ${url}`));
      });

      const result = await getBlocksAndMempool();
      expect(result.blocks[0].medianFee).toBe(7);
      expect(result.blocks[0].avgFeeRate).toBe(0);
      expect(result.blocks[1].avgFeeRate).toBe(10);
    } finally {
      vi.useRealTimers();
    }
  });

  it("handles simple estimator confirmed blocks with avg fee rate >= 1", async () => {
    hoisted.nodeConfig.findFirst.mockResolvedValue({
      isDefault: true,
      mempoolEstimator: "simple",
    });

    const blocks = [
      {
        id: "s1",
        height: 130,
        version: 1,
        timestamp: 1735689600,
        tx_count: 1100,
        size: 100,
        weight: 400,
        merkle_root: "m",
        previousblockhash: "p",
        medianFee: 10,
        feeRange: [8, 12],
        extras: {
          medianFee: 10,
          feeRange: [8, 12],
          reward: 0,
          totalFees: 1000,
        },
      },
    ];

    hoisted.axiosGet.mockImplementation((url: string) => {
      if (url.endsWith("/v1/blocks")) {
        return Promise.resolve({ data: blocks });
      }
      if (url.endsWith("/mempool")) {
        return Promise.resolve({
          data: {
            count: 50,
            fee_histogram: [],
            total_fee: 1000,
            vsize: 1200000,
          },
        });
      }
      if (url.endsWith("/v1/fees/mempool-blocks")) {
        return Promise.resolve({ data: [] });
      }
      if (url.endsWith("/v1/fees/recommended")) {
        return Promise.resolve({
          data: {
            economyFee: 2,
            fastestFee: 12,
            halfHourFee: 8,
            hourFee: 5,
            minimumFee: 1,
          },
        });
      }
      return Promise.reject(new Error(`unexpected url ${url}`));
    });

    const result = await getBlocksAndMempool();
    expect(result.blocks[0].avgFeeRate).toBe(10);
  });

  it("handles mempool-space confirmed block median fee fallbacks", async () => {
    hoisted.nodeConfig.findFirst.mockResolvedValue({
      isDefault: true,
      mempoolEstimator: "mempool_space",
    });

    const blocks = mockBlocks(1735689600).map((block) => ({
      ...block,
      extras: { ...block.extras },
    }));
    blocks[0].extras.medianFee = 0;
    blocks[0].extras.avgFeeRate = 0;
    blocks[0].extras.totalFees = 0;
    blocks[0].extras.feeRange = [1, 2, 3, 4, 5];
    blocks[0].medianFee = 0;
    blocks[1].extras.medianFee = 0;
    blocks[1].extras.avgFeeRate = 0;
    blocks[1].extras.totalFees = 0;
    blocks[1].extras.feeRange = [9];
    blocks[1].medianFee = 0;
    blocks.push({
      ...blocks[1],
      id: "b3",
      height: 98,
      extras: {
        ...blocks[1].extras,
        avgFeeRate: 0,
        feeRange: [],
        medianFee: 0,
        totalFees: 0,
      },
      feeRange: [],
      medianFee: 0,
    });

    hoisted.axiosGet.mockImplementation((url: string) => {
      if (url.endsWith("/v1/blocks")) {
        return Promise.resolve({ data: blocks });
      }
      if (url.endsWith("/mempool")) {
        return Promise.resolve({
          data: {
            count: 100,
            fee_histogram: [],
            total_fee: 5000,
            vsize: 2500000,
          },
        });
      }
      if (url.endsWith("/v1/fees/mempool-blocks")) {
        return Promise.resolve({
          data: [
            {
              blockVSize: 1000000,
              feeRange: [6, 18],
              medianFee: 12,
              nTx: 220,
              totalFees: 120000,
            },
          ],
        });
      }
      if (url.endsWith("/v1/fees/recommended")) {
        return Promise.resolve({
          data: {
            economyFee: 2,
            fastestFee: 12,
            halfHourFee: 9,
            hourFee: 6,
            minimumFee: 1,
          },
        });
      }
      return Promise.reject(new Error(`unexpected url ${url}`));
    });

    const result = await getBlocksAndMempool();

    expect(result.blocks[0].medianFee).toBe(3);
    expect(result.blocks[1].medianFee).toBe(9);
    expect(result.blocks[2].medianFee).toBe(1);
  });

  it("rethrows when dashboard aggregation fails before fallback can run", async () => {
    hoisted.nodeConfig.findFirst.mockResolvedValue({
      isDefault: true,
      mempoolEstimator: "simple",
    });
    hoisted.axiosGet.mockRejectedValueOnce(new Error("blocks endpoint down"));

    await expect(getBlocksAndMempool()).rejects.toThrow(
      "Failed to fetch recent blocks from mempool.space",
    );
  });
}
