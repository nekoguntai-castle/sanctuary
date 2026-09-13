import { describe, expect, it } from "vitest";

import { mockGet, setupRemainingApiModuleMocks } from "./remainingApiModules.testHarness";

import * as bitcoinApi from "../../src/api/bitcoin";

describe("Bitcoin API", () => {
  setupRemainingApiModuleMocks();

  it("gets Silent Payments readiness for the default and selected network", async () => {
    const readiness: bitcoinApi.SilentPaymentReadiness = {
      featureEnabled: true,
      ready: true,
      network: "mainnet",
      requiredFeatures: ["silent_payments_v0"],
      blockers: [],
      compatibleServerCount: 1,
      endpointCount: 1,
      featurePoolHealthy: true,
      servers: [],
    };
    mockGet.mockResolvedValue(readiness);

    await expect(bitcoinApi.getSilentPaymentReadiness()).resolves.toBe(readiness);
    await expect(bitcoinApi.getSilentPaymentReadiness("testnet3")).resolves.toBe(readiness);

    expect(mockGet).toHaveBeenCalledWith("/bitcoin/silent-payments/readiness", {
      network: "mainnet",
    });
    expect(mockGet).toHaveBeenCalledWith("/bitcoin/silent-payments/readiness", {
      network: "testnet3",
    });
  });

  describe("getStatus network normalization", () => {
    it("fills in the requested network when the response omits it (minimal legacy envelope)", async () => {
      mockGet.mockResolvedValue({ connected: false, error: "config read failed" });

      await expect(bitcoinApi.getStatus("testnet3")).resolves.toEqual({
        connected: false,
        error: "config read failed",
        network: "testnet3",
      });
    });

    it("defaults to mainnet when called with no network argument", async () => {
      mockGet.mockResolvedValue({ connected: false, error: "config read failed" });

      await expect(bitcoinApi.getStatus()).resolves.toEqual({
        connected: false,
        error: "config read failed",
        network: "mainnet",
      });
    });

    it("never overwrites a network already present on the response", async () => {
      mockGet.mockResolvedValue({ connected: true, network: "signet" });

      // Requested mainnet, but the backend's own (truthful) answer says signet —
      // that must survive untouched.
      await expect(bitcoinApi.getStatus("mainnet")).resolves.toEqual({
        connected: true,
        network: "signet",
      });
    });

    // #1067 added `as Parameters<typeof getStatus>[0]` casts at the three call
    // sites instead of normalizing here, silencing the type error that would
    // have caught this: a legacy 'testnet' wallet network reaches the backend
    // unnormalized and /bitcoin/status 400s on it, while /bitcoin/fees (which
    // does normalize) works fine for the same wallet.
    it("normalizes a legacy 'testnet' network to testnet3 before issuing the request", async () => {
      mockGet.mockResolvedValue({ connected: true });

      await bitcoinApi.getStatus("testnet");

      expect(mockGet).toHaveBeenCalledWith("/bitcoin/status", { network: "testnet3" });
    });

    it("resolves an undefined network to mainnet", async () => {
      mockGet.mockResolvedValue({ connected: true });

      await bitcoinApi.getStatus(undefined);

      expect(mockGet).toHaveBeenCalledWith("/bitcoin/status", { network: "mainnet" });
    });

    it("resolves a null network to mainnet", async () => {
      mockGet.mockResolvedValue({ connected: true });

      await bitcoinApi.getStatus(null);

      expect(mockGet).toHaveBeenCalledWith("/bitcoin/status", { network: "mainnet" });
    });

    it("resolves an unrecognized network string to mainnet", async () => {
      mockGet.mockResolvedValue({ connected: true });

      await bitcoinApi.getStatus("not-a-real-network");

      expect(mockGet).toHaveBeenCalledWith("/bitcoin/status", { network: "mainnet" });
    });

    it("passes testnet4 and signet through unchanged", async () => {
      mockGet.mockResolvedValue({ connected: true });

      await bitcoinApi.getStatus("testnet4");
      expect(mockGet).toHaveBeenCalledWith("/bitcoin/status", { network: "testnet4" });

      await bitcoinApi.getStatus("signet");
      expect(mockGet).toHaveBeenCalledWith("/bitcoin/status", { network: "signet" });
    });
  });
  describe("network identity stamping", () => {
    /**
     * `placeholderData: keepPreviousData` hands a consumer the previous
     * network's payload while the new query is in flight. Neither FeeEstimates
     * nor MempoolData carried any identity, so that leak was undetectable.
     * These stamp the requested network exactly as getStatus already does.
     */
    it("stamps the requested network onto fee estimates", async () => {
      mockGet.mockResolvedValue({ fastest: 5, halfHour: 4, hour: 3, economy: 1 });

      await expect(bitcoinApi.getFeeEstimates("testnet4")).resolves.toMatchObject({
        network: "testnet4",
      });
    });

    it("defaults the fee stamp to mainnet when no network was requested", async () => {
      mockGet.mockResolvedValue({ fastest: 5, halfHour: 4, hour: 3, economy: 1 });

      await expect(bitcoinApi.getFeeEstimates()).resolves.toMatchObject({ network: "mainnet" });
    });

    it("preserves a server-declared fee network instead of overwriting it", async () => {
      mockGet.mockResolvedValue({ fastest: 5, halfHour: 4, hour: 3, economy: 1, network: "signet" });

      await expect(bitcoinApi.getFeeEstimates("testnet4")).resolves.toMatchObject({
        network: "signet",
      });
    });

    it("stamps the requested network onto mempool data", async () => {
      mockGet.mockResolvedValue({ mempool: [], blocks: [], mempoolInfo: null });

      await expect(bitcoinApi.getMempoolData("testnet4")).resolves.toMatchObject({
        network: "testnet4",
      });
    });

    it("preserves a server-declared mempool network instead of overwriting it", async () => {
      mockGet.mockResolvedValue({ mempool: [], blocks: [], mempoolInfo: null, network: "signet" });

      await expect(bitcoinApi.getMempoolData("testnet4")).resolves.toMatchObject({
        network: "signet",
      });
    });
  });

});
