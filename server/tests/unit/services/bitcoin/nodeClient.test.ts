import { beforeEach, describe, vi } from "vitest";
import { mockPrismaClient, resetPrismaMocks } from "../../../mocks/prisma";
import { registerNodeClientActiveConfigTests } from "./nodeClient.active-config.contracts";
import { registerNodeClientSelectionTests } from "./nodeClient.client-selection.contracts";
import { registerNodeClientTestConfigTests } from "./nodeClient.test-node-config.contracts";
import type { NodeClientTestContext } from "./nodeClientTestContext";

const mocks = vi.hoisted(() => ({
  getElectrumPoolForNetwork: vi.fn(),
  getElectrumPool: vi.fn(),
  resetElectrumPool: vi.fn(),
  resetElectrumPoolForNetwork: vi.fn(),
  initializeElectrumPool: vi.fn(),
  getElectrumClientForNetwork: vi.fn(),
  resetElectrumClient: vi.fn(),
  electrumClientCtor: vi.fn(),
  verifyNodeClientNetwork: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../../../src/models/prisma", async () => {
  const { mockPrismaClient: prisma } = await import("../../../mocks/prisma");
  return {
    __esModule: true,
    default: prisma,
  };
});

const mockSaveAsDefault = vi.fn<any>().mockResolvedValue(undefined);

vi.mock("../../../../src/repositories", async () => {
  const { mockPrismaClient: prisma } = await import("../../../mocks/prisma");
  return {
    nodeConfigRepository: {
      findDefault: (...args: unknown[]) => prisma.nodeConfig.findFirst(...args),
      findDefaultWithServers: (...args: unknown[]) =>
        prisma.nodeConfig.findFirst(...args),
      findOrCreateDefault: vi.fn(),
      update: vi.fn(),
      saveAsDefault: (...args: unknown[]) => mockSaveAsDefault(...args),
      electrumServer: {
        updateHealth: vi.fn().mockResolvedValue(undefined),
      },
    },
  };
});

vi.mock("../../../../src/services/bitcoin/electrumPool", () => ({
  initializeElectrumPool: mocks.initializeElectrumPool,
  resetElectrumPool: mocks.resetElectrumPool,
  getElectrumPool: mocks.getElectrumPool,
  getElectrumPoolForNetwork: mocks.getElectrumPoolForNetwork,
  resetElectrumPoolForNetwork: mocks.resetElectrumPoolForNetwork,
}));

vi.mock("../../../../src/services/bitcoin/electrum", () => ({
  ElectrumClient: function MockElectrumClient(...args: unknown[]) {
    return mocks.electrumClientCtor(...args);
  },
  getElectrumClientForNetwork: mocks.getElectrumClientForNetwork,
  resetElectrumClient: mocks.resetElectrumClient,
}));

vi.mock("../../../../src/services/bitcoin/networkIdentity", () => ({
  verifyNodeClientNetwork: mocks.verifyNodeClientNetwork,
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

import {
  getActiveNodeConfig,
  getElectrumClientIfActive,
  getNodeClient,
  resetNodeClient,
  saveNodeConfig,
  testNodeConfig,
} from "../../../../src/services/bitcoin/nodeClient";

function buildNodeConfig(overrides: Record<string, unknown> = {}) {
  return {
    id: "default",
    isDefault: true,
    host: "electrum.mainnet.example",
    port: 50002,
    useSsl: true,
    poolEnabled: true,
    mainnetMode: "pool",
    mainnetSingletonHost: "electrum.mainnet.example",
    mainnetSingletonPort: 50002,
    mainnetSingletonSsl: true,
    mainnetPoolMin: 1,
    mainnetPoolMax: 5,
    mainnetPoolLoadBalancing: "round_robin",
    testnetEnabled: true,
    testnetMode: "singleton",
    testnetSingletonHost: "electrum.testnet.example",
    testnetSingletonPort: 60002,
    testnetSingletonSsl: true,
    testnetPoolMin: 1,
    testnetPoolMax: 3,
    testnetPoolLoadBalancing: "round_robin",
    testnet4Enabled: true,
    testnet4Mode: "singleton",
    testnet4SingletonHost: "electrum.testnet4.example",
    testnet4SingletonPort: 60004,
    testnet4SingletonSsl: true,
    testnet4PoolMin: 1,
    testnet4PoolMax: 3,
    testnet4PoolLoadBalancing: "round_robin",
    signetEnabled: true,
    signetMode: "singleton",
    signetSingletonHost: "electrum.signet.example",
    signetSingletonPort: 60003,
    signetSingletonSsl: true,
    signetPoolMin: 1,
    signetPoolMax: 3,
    signetPoolLoadBalancing: "round_robin",
    ...overrides,
  };
}

describe("nodeClient service", () => {
  const mainnetSingleton = {
    connect: vi.fn(),
    disconnect: vi.fn(),
    isConnected: vi.fn(),
    getBlockHeight: vi.fn(),
  };
  const testnetSingleton = {
    connect: vi.fn(),
    disconnect: vi.fn(),
    isConnected: vi.fn(),
    getBlockHeight: vi.fn(),
  };
  const poolSubscriptionClient = {
    connect: vi.fn(),
    disconnect: vi.fn(),
    isConnected: vi.fn(),
    getBlockHeight: vi.fn(),
  };
  const poolFacade = {
    getSubscriptionConnection: vi.fn(),
    isPoolInitialized: vi.fn(),
  };

  beforeEach(async () => {
    resetPrismaMocks();
    vi.clearAllMocks();

    mainnetSingleton.connect.mockResolvedValue(undefined);
    mainnetSingleton.disconnect.mockImplementation(() => undefined);
    mainnetSingleton.isConnected.mockReturnValue(true);

    testnetSingleton.connect.mockResolvedValue(undefined);
    testnetSingleton.disconnect.mockImplementation(() => undefined);
    testnetSingleton.isConnected.mockReturnValue(true);

    poolSubscriptionClient.isConnected.mockReturnValue(true);
    poolFacade.getSubscriptionConnection.mockResolvedValue(
      poolSubscriptionClient,
    );
    poolFacade.isPoolInitialized.mockReturnValue(true);

    mocks.getElectrumClientForNetwork.mockImplementation((network: string) => {
      if (network === "testnet3") return testnetSingleton;
      return mainnetSingleton;
    });
    mocks.getElectrumPoolForNetwork.mockResolvedValue(poolFacade);
    mocks.getElectrumPool.mockReturnValue(poolFacade);
    mocks.resetElectrumPool.mockResolvedValue(undefined);
    mocks.resetElectrumPoolForNetwork.mockResolvedValue(undefined);
    mocks.resetElectrumClient.mockImplementation(() => undefined);
    mocks.electrumClientCtor.mockImplementation(() => ({
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn(),
      getServerVersion: vi.fn().mockResolvedValue({ server: 'ElectrumX', protocol: '1.4' }),
      getServerFeatures: vi.fn().mockResolvedValue({ server_version: 'ElectrumX' }),
      getBlockHeight: vi.fn().mockResolvedValue(850000),
      getBlockHeader: vi.fn(),
      testVerboseSupport: vi.fn().mockResolvedValue(true),
    }));

    mockPrismaClient.nodeConfig.findFirst.mockResolvedValue(buildNodeConfig());

    await resetNodeClient();
  });

  const context: NodeClientTestContext = {
    mocks,
    mockPrismaClient,
    mockSaveAsDefault,
    buildNodeConfig,
    mainnetSingleton,
    testnetSingleton,
    poolSubscriptionClient,
    poolFacade,
    getNodeClient,
    getActiveNodeConfig,
    getElectrumClientIfActive,
    resetNodeClient,
    saveNodeConfig,
    testNodeConfig,
  };

  registerNodeClientSelectionTests(context);
  registerNodeClientActiveConfigTests(context);
  registerNodeClientTestConfigTests(context);
});
