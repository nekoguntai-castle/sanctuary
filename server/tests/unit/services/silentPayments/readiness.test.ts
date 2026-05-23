import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isFeatureEnabled: vi.fn(),
  findDefaultWithServers: vi.fn(),
  getElectrumPoolForNetworkAndFeatures: vi.fn(),
}));

vi.mock("../../../../src/services/featureFlagService", () => ({
  featureFlagService: {
    isEnabled: mocks.isFeatureEnabled,
  },
}));

vi.mock("../../../../src/repositories/nodeConfigRepository", () => ({
  nodeConfigRepository: {
    findDefaultWithServers: mocks.findDefaultWithServers,
  },
}));

vi.mock("../../../../src/services/bitcoin/electrumPool", () => ({
  getElectrumPoolForNetworkAndFeatures:
    mocks.getElectrumPoolForNetworkAndFeatures,
}));

vi.mock("../../../../src/utils/logger", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock("../../../../src/utils/errors", () => ({
  getErrorMessage: (error: unknown) =>
    error instanceof Error ? error.message : String(error),
}));

import { getSilentPaymentReadiness } from "../../../../src/services/silentPayments/readiness";

function buildNodeConfig(servers: Array<Record<string, unknown>>) {
  return {
    type: "electrum",
    servers,
  };
}

function buildServer(overrides: Record<string, unknown> = {}) {
  return {
    id: "srv-1",
    label: "Frigate",
    host: "frigate.example.com",
    port: 50002,
    useSsl: true,
    enabled: true,
    network: "mainnet",
    serverUsage: "silent_payments",
    supportsSilentPaymentsV0: true,
    silentPaymentVersions: [0],
    lastCapabilityCheck: new Date(),
    lastCapabilityError: null,
    ...overrides,
  };
}

function buildHealthyPool() {
  return {
    isPoolInitialized: vi.fn().mockReturnValue(true),
    getPoolStats: vi.fn().mockReturnValue({
      servers: [{ isHealthy: true, healthyConnections: 1 }],
    }),
  };
}

describe("Silent Payments readiness", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isFeatureEnabled.mockResolvedValue(true);
    mocks.findDefaultWithServers.mockResolvedValue(
      buildNodeConfig([buildServer()]),
    );
    mocks.getElectrumPoolForNetworkAndFeatures.mockResolvedValue(
      buildHealthyPool(),
    );
  });

  it("reports ready when the feature flag, dedicated endpoint, capability profile, and pool are healthy", async () => {
    const readiness = await getSilentPaymentReadiness("mainnet");

    expect(readiness).toMatchObject({
      featureEnabled: true,
      ready: true,
      network: "mainnet",
      blockers: [],
      compatibleServerCount: 1,
      endpointCount: 1,
      featurePoolHealthy: true,
    });
    expect(mocks.getElectrumPoolForNetworkAndFeatures).toHaveBeenCalledWith(
      "mainnet",
      ["silent_payments_v0"],
      { serverUsage: "silent_payments" },
    );
  });

  it("does not initialize the feature pool when the feature flag is disabled", async () => {
    mocks.isFeatureEnabled.mockResolvedValue(false);

    const readiness = await getSilentPaymentReadiness("mainnet");

    expect(readiness.ready).toBe(false);
    expect(readiness.blockers).toEqual(["FEATURE_DISABLED"]);
    expect(readiness.featurePoolHealthy).toBe(false);
    expect(mocks.getElectrumPoolForNetworkAndFeatures).not.toHaveBeenCalled();
  });

  it("fails closed for stale or unknown Silent Payments capability profiles", async () => {
    mocks.findDefaultWithServers.mockResolvedValue(
      buildNodeConfig([
        buildServer({
          id: "stale",
          lastCapabilityCheck: new Date(Date.now() - 25 * 60 * 60 * 1000),
        }),
        buildServer({
          id: "unknown",
          supportsSilentPaymentsV0: null,
          silentPaymentVersions: null,
          lastCapabilityCheck: null,
        }),
      ]),
    );

    const readiness = await getSilentPaymentReadiness("mainnet");

    expect(readiness.ready).toBe(false);
    expect(readiness.blockers).toEqual(["NO_COMPATIBLE_SERVER"]);
    expect(readiness.compatibleServerCount).toBe(0);
    expect(readiness.servers.map((server) => server.capabilityStatus)).toEqual([
      "stale",
      "unknown",
    ]);
    expect(mocks.getElectrumPoolForNetworkAndFeatures).not.toHaveBeenCalled();
  });

  it("requires a dedicated Silent Payments endpoint on the selected network", async () => {
    mocks.findDefaultWithServers.mockResolvedValue(
      buildNodeConfig([
        buildServer({ network: "testnet3" }),
        buildServer({ id: "general", serverUsage: "general" }),
        buildServer({ id: "disabled", enabled: false }),
      ]),
    );

    const readiness = await getSilentPaymentReadiness("mainnet");

    expect(readiness.ready).toBe(false);
    expect(readiness.blockers).toEqual(["NO_SILENT_PAYMENT_ENDPOINT"]);
    expect(readiness.endpointCount).toBe(0);
    expect(mocks.getElectrumPoolForNetworkAndFeatures).not.toHaveBeenCalled();
  });

  it("reports compatible endpoints as blocked when the feature pool is unhealthy", async () => {
    mocks.getElectrumPoolForNetworkAndFeatures.mockResolvedValue({
      isPoolInitialized: vi.fn().mockReturnValue(true),
      getPoolStats: vi.fn().mockReturnValue({
        servers: [{ isHealthy: true, healthyConnections: 0 }],
      }),
    });

    const readiness = await getSilentPaymentReadiness("mainnet");

    expect(readiness.ready).toBe(false);
    expect(readiness.blockers).toEqual(["FEATURE_POOL_UNHEALTHY"]);
    expect(readiness.featurePoolHealthy).toBe(false);
  });

  it("treats an uninitialized feature pool as unhealthy", async () => {
    mocks.getElectrumPoolForNetworkAndFeatures.mockResolvedValue({
      isPoolInitialized: vi.fn().mockReturnValue(false),
      getPoolStats: vi.fn(),
    });

    const readiness = await getSilentPaymentReadiness("mainnet");

    expect(readiness.ready).toBe(false);
    expect(readiness.blockers).toEqual(["FEATURE_POOL_UNHEALTHY"]);
    expect(readiness.featurePoolHealthy).toBe(false);
  });

  it("reports the feature pool as unavailable when scoped pool construction fails", async () => {
    mocks.getElectrumPoolForNetworkAndFeatures.mockRejectedValue(
      new Error("Frigate pool unavailable"),
    );

    const readiness = await getSilentPaymentReadiness("mainnet");

    expect(readiness.ready).toBe(false);
    expect(readiness.blockers).toEqual(["FEATURE_POOL_UNAVAILABLE"]);
    expect(readiness.compatibleServerCount).toBe(1);
    expect(readiness.featurePoolHealthy).toBe(false);
  });

  it("ignores non-Electrum default configs", async () => {
    mocks.findDefaultWithServers.mockResolvedValue({
      type: "bitcoind",
      servers: [buildServer()],
    });

    const readiness = await getSilentPaymentReadiness("mainnet");

    expect(readiness.ready).toBe(false);
    expect(readiness.blockers).toEqual(["NO_SILENT_PAYMENT_ENDPOINT"]);
    expect(readiness.servers).toEqual([]);
  });
});
