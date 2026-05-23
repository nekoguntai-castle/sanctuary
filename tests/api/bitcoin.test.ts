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
});
