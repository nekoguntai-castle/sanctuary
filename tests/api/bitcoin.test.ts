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
  });
});
