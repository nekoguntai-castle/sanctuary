import { describe, it, expect, beforeEach, vi } from "vitest";

const { mockGetNodeClient, mockResetNodeClient, mockLogger } = vi.hoisted(
  () => ({
    mockGetNodeClient: vi.fn(),
    mockResetNodeClient: vi.fn(),
    mockLogger: {
      debug: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
    },
  }),
);

vi.mock("../../../../src/services/bitcoin/nodeClient", () => ({
  getNodeClient: mockGetNodeClient,
  resetNodeClient: mockResetNodeClient,
}));

vi.mock("../../../../src/utils/logger", () => ({
  createLogger: vi.fn(() => mockLogger),
}));

async function loadModule() {
  vi.resetModules();
  return import("../../../../src/services/bitcoin/utils/blockHeight");
}

describe("blockHeight utils", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResetNodeClient.mockResolvedValue(undefined);
  });

  describe("cached block height", () => {
    it("keeps highest height per network and does not downgrade", async () => {
      const { getCachedBlockHeight, setCachedBlockHeight } = await loadModule();

      expect(getCachedBlockHeight("mainnet")).toBe(0);
      expect(getCachedBlockHeight("testnet")).toBe(0);

      setCachedBlockHeight(123, "mainnet");
      setCachedBlockHeight(99, "mainnet");
      setCachedBlockHeight(456, "testnet");

      expect(getCachedBlockHeight("mainnet")).toBe(123);
      expect(getCachedBlockHeight("testnet")).toBe(456);
      expect(mockLogger.debug).toHaveBeenCalledTimes(2);
    });
  });

  describe("getBlockHeight", () => {
    it("fetches from node and updates cache", async () => {
      const { getBlockHeight, getCachedBlockHeight } = await loadModule();
      mockGetNodeClient.mockResolvedValue({
        getBlockHeight: vi.fn().mockResolvedValue(812345),
      });

      const height = await getBlockHeight("signet");

      expect(height).toBe(812345);
      expect(getCachedBlockHeight("signet")).toBe(812345);
      expect(mockGetNodeClient).toHaveBeenCalledWith("signet");
    });

    it("returns cached height when node call fails and cache exists", async () => {
      const { getBlockHeight, setCachedBlockHeight } = await loadModule();
      setCachedBlockHeight(777777, "mainnet");
      mockGetNodeClient.mockRejectedValue(new Error("node down"));

      await expect(getBlockHeight("mainnet")).resolves.toBe(777777);
      expect(mockLogger.error).toHaveBeenCalled();
    });

    it("reconnects and retries once after a transient connection close", async () => {
      const { getBlockHeight, getCachedBlockHeight } = await loadModule();
      const firstClient = {
        getBlockHeight: vi
          .fn()
          .mockRejectedValue(new Error("Connection ended")),
      };
      const secondClient = {
        getBlockHeight: vi.fn().mockResolvedValue(812346),
      };
      mockGetNodeClient
        .mockResolvedValueOnce(firstClient)
        .mockResolvedValueOnce(secondClient);

      await expect(getBlockHeight("mainnet")).resolves.toBe(812346);

      expect(mockResetNodeClient).toHaveBeenCalledWith("mainnet");
      expect(mockGetNodeClient).toHaveBeenCalledTimes(2);
      expect(getCachedBlockHeight("mainnet")).toBe(812346);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        "Retrying block height after transient connection error",
        expect.objectContaining({ network: "mainnet" }),
      );
      expect(mockLogger.error).not.toHaveBeenCalled();
    });

    it("falls back to cache when transient retry also fails", async () => {
      const { getBlockHeight, setCachedBlockHeight } = await loadModule();
      setCachedBlockHeight(777778, "mainnet");
      mockGetNodeClient
        .mockResolvedValueOnce({
          getBlockHeight: vi.fn().mockRejectedValue(new Error("socket closed")),
        })
        .mockResolvedValueOnce({
          getBlockHeight: vi.fn().mockRejectedValue(new Error("still closed")),
        });

      await expect(getBlockHeight("mainnet")).resolves.toBe(777778);

      expect(mockResetNodeClient).toHaveBeenCalledWith("mainnet");
      expect(mockLogger.error).toHaveBeenCalledWith(
        "Failed to get block height after retry",
        expect.objectContaining({ network: "mainnet" }),
      );
    });

    it("throws when node call fails and no cache exists", async () => {
      const { getBlockHeight } = await loadModule();
      const error = new Error("totally down");
      mockGetNodeClient.mockRejectedValue(error);

      await expect(getBlockHeight("regtest")).rejects.toThrow("totally down");
      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  describe("LRUCache", () => {
    it("supports get/has/set/update/evict/clear and size", async () => {
      const { LRUCache } = await loadModule();
      const cache = new LRUCache<string, number>(2);

      expect(cache.size).toBe(0);
      expect(cache.get("missing")).toBeUndefined();
      expect(cache.has("a")).toBe(false);

      cache.set("a", 1);
      cache.set("b", 2);
      expect(cache.size).toBe(2);
      expect(cache.has("a")).toBe(true);

      // Touch a, then adding c should evict b (oldest)
      expect(cache.get("a")).toBe(1);
      cache.set("c", 3);
      expect(cache.has("a")).toBe(true);
      expect(cache.has("b")).toBe(false);
      expect(cache.has("c")).toBe(true);

      // Updating existing key should not increase size
      cache.set("a", 9);
      expect(cache.get("a")).toBe(9);
      expect(cache.size).toBe(2);

      cache.clear();
      expect(cache.size).toBe(0);
    });

    it("handles zero-capacity eviction edge without deleting undefined keys", async () => {
      const { LRUCache } = await loadModule();
      const cache = new LRUCache<string, number>(0);

      cache.set("a", 1);

      expect(cache.get("a")).toBe(1);
      expect(cache.size).toBe(1);
    });
  });

  describe("getBlockTimestamp", () => {
    it("returns null for non-positive heights", async () => {
      const { getBlockTimestamp } = await loadModule();

      await expect(getBlockTimestamp(0)).resolves.toBeNull();
      await expect(getBlockTimestamp(-1)).resolves.toBeNull();
      expect(mockGetNodeClient).not.toHaveBeenCalled();
    });

    it("parses timestamp from header and uses cache on second call", async () => {
      const { getBlockTimestamp } = await loadModule();
      const unix = 1_700_000_000;
      const ts = Buffer.alloc(4);
      ts.writeUInt32LE(unix, 0);
      const headerHex = "00".repeat(68) + ts.toString("hex") + "00".repeat(8);
      const getBlockHeader = vi.fn().mockResolvedValue(headerHex);
      mockGetNodeClient.mockResolvedValue({ getBlockHeader });

      const first = await getBlockTimestamp(500_000, "testnet");
      const second = await getBlockTimestamp(500_000, "mainnet");

      expect(first?.toISOString()).toBe(new Date(unix * 1000).toISOString());
      expect(second?.toISOString()).toBe(new Date(unix * 1000).toISOString());
      expect(mockGetNodeClient).toHaveBeenCalledTimes(1);
      expect(getBlockHeader).toHaveBeenCalledTimes(1);
    });

    it("returns null and logs warning when header lookup fails", async () => {
      const { getBlockTimestamp } = await loadModule();
      mockGetNodeClient.mockResolvedValue({
        getBlockHeader: vi.fn().mockRejectedValue(new Error("header fail")),
      });

      await expect(getBlockTimestamp(42, "mainnet")).resolves.toBeNull();
      expect(mockLogger.warn).toHaveBeenCalled();
    });
  });
});
