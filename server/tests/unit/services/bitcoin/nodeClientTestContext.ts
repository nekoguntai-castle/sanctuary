import type {
  getActiveNodeConfig,
  getElectrumClientIfActive,
  getNodeClient,
  resetNodeClient,
  saveNodeConfig,
  testNodeConfig,
} from "../../../../src/services/bitcoin/nodeClient";

export type NodeClientTestContext = {
  mocks: any;
  mockPrismaClient: any;
  mockSaveAsDefault: any;
  buildNodeConfig: (
    overrides?: Record<string, unknown>,
  ) => Record<string, unknown>;
  mainnetSingleton: any;
  testnetSingleton: any;
  poolSubscriptionClient: any;
  poolFacade: any;
  getNodeClient: typeof getNodeClient;
  getActiveNodeConfig: typeof getActiveNodeConfig;
  getElectrumClientIfActive: typeof getElectrumClientIfActive;
  resetNodeClient: typeof resetNodeClient;
  saveNodeConfig: typeof saveNodeConfig;
  testNodeConfig: typeof testNodeConfig;
};
