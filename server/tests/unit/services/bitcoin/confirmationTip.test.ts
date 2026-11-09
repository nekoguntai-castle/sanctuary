import { beforeEach, describe, expect, it, vi } from "vitest";

// Regression: the API process computed confirmations from its own block-height
// cache, which only the worker advances (in the worker's process). A healthy
// worker therefore left the API on its startup height, and transactions mined
// after API start reported 0 confirmations. The tip must come from the durable
// network header checkpoint the worker persists.

const { mockFindCheckpoint, mockLogger } = vi.hoisted(() => ({
  mockFindCheckpoint: vi.fn(),
  mockLogger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("../../../../src/repositories/networkHeaderCheckpointRepository", () => ({
  findNetworkHeaderCheckpoint: mockFindCheckpoint,
}));

vi.mock("../../../../src/services/bitcoin/nodeClient", () => ({
  getNodeClient: vi.fn(),
  resetNodeClient: vi.fn(),
}));

vi.mock("../../../../src/utils/logger", () => ({
  createLogger: vi.fn(() => mockLogger),
}));

async function loadModules() {
  vi.resetModules();
  const blockHeight = await import("../../../../src/services/bitcoin/utils/blockHeight");
  const tip = await import("../../../../src/services/bitcoin/utils/confirmationTip");
  return { ...blockHeight, ...tip };
}

function checkpointAt(height: number) {
  return {
    network: "mainnet",
    lastProcessedHeight: height,
    lastProcessedHash: "00".repeat(32),
    observedAt: new Date(),
    coverageGapStartedAt: null,
  };
}

describe("getConfirmationTipHeight", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("follows the durable checkpoint when the process cache is stale", async () => {
    const { getConfirmationTipHeight, setCachedBlockHeight } = await loadModules();
    setCachedBlockHeight(850_000, "mainnet"); // API startup warm
    mockFindCheckpoint.mockResolvedValue(checkpointAt(850_010)); // worker advanced

    await expect(getConfirmationTipHeight("mainnet")).resolves.toBe(850_010);
    expect(mockFindCheckpoint).toHaveBeenCalledWith("mainnet");
  });

  it("follows a reorged checkpoint below the process cache", async () => {
    const { getConfirmationTipHeight, setCachedBlockHeight } = await loadModules();
    setCachedBlockHeight(850_010, "mainnet");
    mockFindCheckpoint.mockResolvedValue(checkpointAt(850_008));

    await expect(getConfirmationTipHeight("mainnet")).resolves.toBe(850_008);
  });

  it("falls back to the process cache when no checkpoint exists", async () => {
    const { getConfirmationTipHeight, setCachedBlockHeight } = await loadModules();
    setCachedBlockHeight(900, "testnet3");
    mockFindCheckpoint.mockResolvedValue(null);

    await expect(getConfirmationTipHeight("testnet3")).resolves.toBe(900);
  });

  it("falls back to the process cache when the checkpoint read fails", async () => {
    const { getConfirmationTipHeight, setCachedBlockHeight } = await loadModules();
    setCachedBlockHeight(850_000, "mainnet");
    mockFindCheckpoint.mockRejectedValue(new Error("db down"));

    await expect(getConfirmationTipHeight("mainnet")).resolves.toBe(850_000);
    expect(mockLogger.warn).toHaveBeenCalled();
  });

  it("returns 0 when neither source has a height", async () => {
    const { getConfirmationTipHeight } = await loadModules();
    mockFindCheckpoint.mockResolvedValue(checkpointAt(0));

    await expect(getConfirmationTipHeight("regtest")).resolves.toBe(0);
  });
});
