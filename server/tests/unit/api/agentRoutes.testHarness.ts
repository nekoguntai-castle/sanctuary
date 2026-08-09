import express, { type Express } from "express";
import request from "supertest";
import { vi } from "vitest";

const mockState = vi.hoisted(() => {
  const mockAgentRateLimitKeys: string[] = [];

  return {
    mockRequireAgentFundingDraftAccess: vi.fn(),
    mockValidateAgentFundingDraftSubmission: vi.fn(),
    mockEnforceAgentFundingPolicy: vi.fn(),
    mockMarkAgentFundingDraftCreated: vi.fn(),
    mockMarkFundingOverrideUsed: vi.fn(),
    mockWithAgentFundingLock: vi.fn(),
    mockWithAgentFundingTransaction: vi.fn(),
    mockCreateFundingAttempt: vi.fn(),
    mockEvaluateRejectedFundingAttemptAlert: vi.fn(),
    mockCreateDraft: vi.fn(),
    mockRunDraftCreatedSideEffects: vi.fn(),
    mockGetDraft: vi.fn(),
    mockUpdateDraft: vi.fn(),
    mockGetOrCreateOperationalReceiveAddress: vi.fn(),
    mockVerifyOperationalReceiveAddress: vi.fn(),
    mockCreateTransaction: vi.fn(),
    mockEvaluatePolicies: vi.fn(),
    mockAuditLog: vi.fn(),
    mockGetClientInfo: vi.fn(),
    mockSerializeDraftTransaction: vi.fn(),
    mockUtxoRepository: {
      getUnspentBalance: vi.fn(),
    },
    mockWalletRepository: {
      findById: vi.fn(),
      findByIdWithDevices: vi.fn(),
    },
    mockAgentRateLimitKeys,
    mockRateLimitByKey: vi.fn(
      (_policyName, keyGenerator: (req: any) => string) => {
        mockAgentRateLimitKeys.push(
          keyGenerator({ agentContext: { keyPrefix: "agt_prefix" } }),
        );
        mockAgentRateLimitKeys.push(keyGenerator({ ip: "203.0.113.10" }));
        mockAgentRateLimitKeys.push(keyGenerator({}));
        return (_req: any, _res: any, next: () => void) => next();
      },
    ),
    agentContext: {
      keyId: "key-1",
      keyPrefix: "agt_prefix",
      userId: "user-1",
      username: "alice",
      agentId: "agent-1",
      agentName: "Treasury Agent",
      agentStatus: "active",
      fundingWalletId: "funding-wallet",
      operationalWalletId: "operational-wallet",
      signerDeviceId: "agent-device",
      scope: { allowedActions: ["create_funding_draft"] },
    },
  };
});

const {
  mockRequireAgentFundingDraftAccess,
  mockValidateAgentFundingDraftSubmission,
  mockEnforceAgentFundingPolicy,
  mockMarkAgentFundingDraftCreated,
  mockMarkFundingOverrideUsed,
  mockWithAgentFundingLock,
  mockWithAgentFundingTransaction,
  mockCreateFundingAttempt,
  mockEvaluateRejectedFundingAttemptAlert,
  mockCreateDraft,
  mockRunDraftCreatedSideEffects,
  mockGetDraft,
  mockUpdateDraft,
  mockGetOrCreateOperationalReceiveAddress,
  mockVerifyOperationalReceiveAddress,
  mockCreateTransaction,
  mockEvaluatePolicies,
  mockAuditLog,
  mockGetClientInfo,
  mockSerializeDraftTransaction,
  mockUtxoRepository,
  mockWalletRepository,
  mockAgentRateLimitKeys,
  mockRateLimitByKey,
  agentContext,
} = mockState;

vi.mock("../../../src/agent/auth", () => ({
  requireAgentFundingDraftAccess: mockState.mockRequireAgentFundingDraftAccess,
}));
vi.mock("../../../src/middleware/agentAuth", () => ({
  authenticateAgent: (req: any, _res: any, next: () => void) => {
    req.agentContext = mockState.agentContext;
    next();
  },
  requireAgentContext: (req: any) => req.agentContext,
}));
vi.mock("../../../src/middleware/rateLimit", () => ({
  rateLimitByKey: mockState.mockRateLimitByKey,
}));
vi.mock("../../../src/services/agentFundingDraftValidation", () => ({
  validateAgentFundingDraftSubmission:
    mockState.mockValidateAgentFundingDraftSubmission,
}));
vi.mock("../../../src/services/agentFundingPolicy", () => ({
  enforceAgentFundingPolicy: mockState.mockEnforceAgentFundingPolicy,
}));
vi.mock("../../../src/services/agentOperationalAddressService", () => ({
  getOrCreateOperationalReceiveAddress:
    mockState.mockGetOrCreateOperationalReceiveAddress,
  verifyOperationalReceiveAddress:
    mockState.mockVerifyOperationalReceiveAddress,
}));
vi.mock("../../../src/services/bitcoin/transactionService", () => ({
  createTransaction: mockState.mockCreateTransaction,
}));
vi.mock("../../../src/services/vaultPolicy", () => ({
  policyEvaluationEngine: {
    evaluatePolicies: mockState.mockEvaluatePolicies,
  },
}));
vi.mock("../../../src/services/agentMonitoringService", () => ({
  evaluateRejectedFundingAttemptAlert:
    mockState.mockEvaluateRejectedFundingAttemptAlert,
}));
vi.mock("../../../src/repositories", () => ({
  agentRepository: {
    markAgentFundingDraftCreated: mockState.mockMarkAgentFundingDraftCreated,
    markFundingOverrideUsed: mockState.mockMarkFundingOverrideUsed,
    withAgentFundingLock: mockState.mockWithAgentFundingLock,
    withAgentFundingTransaction: mockState.mockWithAgentFundingTransaction,
    createFundingAttempt: mockState.mockCreateFundingAttempt,
  },
  utxoRepository: mockState.mockUtxoRepository,
  walletRepository: mockState.mockWalletRepository,
}));

vi.mock("../../../src/services/draftService", () => ({
  draftService: {
    createDraft: mockState.mockCreateDraft,
    runDraftCreatedSideEffects: mockState.mockRunDraftCreatedSideEffects,
    getDraft: mockState.mockGetDraft,
    updateDraft: mockState.mockUpdateDraft,
  },
}));
vi.mock("../../../src/services/auditService", () => ({
  AuditAction: {
    AGENT_FUNDING_DRAFT_SUBMIT: "wallet.agent_funding_draft_submit",
    AGENT_OVERRIDE_USE: "wallet.agent_override_use",
  },
  AuditCategory: {
    WALLET: "wallet",
  },
  auditService: {
    log: mockState.mockAuditLog,
  },
  getClientInfo: mockState.mockGetClientInfo,
}));

vi.mock("../../../src/utils/serialization", () => ({
  serializeDraftTransaction: mockState.mockSerializeDraftTransaction,
}));
vi.mock("../../../src/utils/logger", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));
vi.mock("../../../src/utils/requestContext", () => ({
  requestContext: {
    getRequestId: () => "test-request-id",
  },
}));

import agentRouter from "../../../src/api/agent";
import { errorHandler } from "../../../src/errors";

const utxoRepository = mockUtxoRepository;
const walletRepository = mockWalletRepository;

export {
  agentContext,
  mockAgentRateLimitKeys,
  mockAuditLog,
  mockCreateDraft,
  mockCreateFundingAttempt,
  mockCreateTransaction,
  mockEnforceAgentFundingPolicy,
  mockEvaluatePolicies,
  mockEvaluateRejectedFundingAttemptAlert,
  mockGetDraft,
  mockGetOrCreateOperationalReceiveAddress,
  mockMarkAgentFundingDraftCreated,
  mockMarkFundingOverrideUsed,
  mockRequireAgentFundingDraftAccess,
  mockRunDraftCreatedSideEffects,
  mockSerializeDraftTransaction,
  mockUpdateDraft,
  mockValidateAgentFundingDraftSubmission,
  mockVerifyOperationalReceiveAddress,
  mockWithAgentFundingLock,
  mockWithAgentFundingTransaction,
  utxoRepository,
  walletRepository,
};

export const fundingDraftPayload = (
  overrides: Record<string, unknown> = {},
) => ({
  operationalWalletId: "operational-wallet",
  recipient: "tb1qrecipient",
  amount: 10000,
  feeRate: 5,
  ...overrides,
});

export const signedFundingDraftPayload = (
  overrides: Record<string, unknown> = {},
) =>
  fundingDraftPayload({
    psbtBase64: "cHNi",
    signedPsbtBase64: "cHNidP8agentSigned",
    ...overrides,
  });

export const createAgentRouteTestApp = (): Express => {
  const app = express();
  app.use(express.json());
  app.use("/api/v1/agent", agentRouter);
  app.use(errorHandler);
  return app;
};

export const postFundingDraft = (app: Express) =>
  request(app)
    .post("/api/v1/agent/wallets/funding-wallet/funding-drafts")
    .set("Authorization", "Bearer agt_test");

export const patchDraftSignature = (app: Express) =>
  request(app)
    .patch(
      "/api/v1/agent/wallets/funding-wallet/funding-drafts/draft-agent/signature",
    )
    .set("Authorization", "Bearer agt_test");

export const resetAgentRouteMocks = () => {
  vi.clearAllMocks();
  agentContext.scope = { allowedActions: ["create_funding_draft"] };
  agentContext.signerDeviceId = "agent-device";
  mockCreateDraft.mockResolvedValue({
    id: "draft-agent",
    amount: BigInt(10000),
    feeRate: 5,
  });
  mockGetDraft.mockResolvedValue({
    id: "draft-agent",
    agentId: "agent-1",
    agentOperationalWalletId: "operational-wallet",
    recipient: "tb1qrecipient",
    amount: BigInt(10000),
    psbtBase64: "cHNi",
  });
  mockUpdateDraft.mockResolvedValue({
    id: "draft-agent",
    amount: BigInt(10000),
    feeRate: 5,
    signedPsbtBase64: "cHNidP8agentSigned",
  });
  mockEnforceAgentFundingPolicy.mockResolvedValue({ overrideId: null });
  mockMarkAgentFundingDraftCreated.mockResolvedValue(undefined);
  mockWithAgentFundingLock.mockImplementation(async (_agentId, fn) => fn());
  mockWithAgentFundingTransaction.mockImplementation(async (_agentId, fn) =>
    fn({ tx: true }),
  );
  mockCreateFundingAttempt.mockResolvedValue({ id: "attempt-1" });
  mockRunDraftCreatedSideEffects.mockResolvedValue(undefined);
  mockAuditLog.mockResolvedValue(undefined);
  mockGetClientInfo.mockReturnValue({
    ipAddress: "127.0.0.1",
    userAgent: "agent-runtime",
  });
  mockSerializeDraftTransaction.mockReturnValue({
    id: "draft-agent",
    serialized: true,
  });
  (walletRepository.findById as any).mockImplementation(
    async (walletId: string) => {
      if (walletId === "funding-wallet") {
        return {
          id: "funding-wallet",
          name: "Funding",
          type: "multi_sig",
          network: "testnet",
        };
      }
      if (walletId === "operational-wallet") {
        return {
          id: "operational-wallet",
          name: "Operational",
          type: "single_sig",
          network: "testnet",
        };
      }
      return null;
    },
  );
  (walletRepository.findByIdWithDevices as any).mockResolvedValue({
    id: "funding-wallet",
    devices: [{ device: { type: "coldcard", model: null } }],
  });
  (utxoRepository.getUnspentBalance as any)
    .mockResolvedValueOnce(20000n)
    .mockResolvedValueOnce(5000n);
  mockGetOrCreateOperationalReceiveAddress.mockResolvedValue({
    walletId: "operational-wallet",
    address: "tb1qoperational",
    derivationPath: "m/84'/1'/0'/0/0",
    index: 0,
    generated: false,
  });
  mockVerifyOperationalReceiveAddress.mockImplementation(
    async ({ operationalWalletId, address }) => ({
      walletId: operationalWalletId,
      address,
      verified: address === "tb1qrecipient" || address === "tb1qoperational",
      derivationPath:
        address === "tb1qrecipient" || address === "tb1qoperational"
          ? "m/84'/1'/0'/0/0"
          : null,
      index:
        address === "tb1qrecipient" || address === "tb1qoperational" ? 0 : null,
    }),
  );
  mockEvaluatePolicies.mockResolvedValue({ allowed: true, triggered: [] });
  mockCreateTransaction.mockResolvedValue({
    psbtBase64: "cHNi",
    fee: 500,
    totalInput: 10500,
    totalOutput: 10000,
    changeAmount: 0,
    changeAddress: undefined,
    utxos: [
      {
        txid: "decoded-txid",
        vout: 0,
        address: "tb1qfunding",
        amount: 10500,
      },
    ],
    inputPaths: ["m/48'/1'/0'/2'/0/0"],
    effectiveAmount: 10000,
    decoyOutputs: undefined,
  });
  mockValidateAgentFundingDraftSubmission.mockResolvedValue({
    recipient: "tb1qrecipient",
    amount: "10000",
    selectedUtxoIds: ["decoded-txid:0"],
    fee: "500",
    totalInput: "10500",
    totalOutput: "10000",
    changeAmount: "0",
    effectiveAmount: "10000",
    enableRBF: false,
    inputs: [
      {
        txid: "decoded-txid",
        vout: 0,
        address: "tb1qfunding",
        amount: 10500,
      },
    ],
    outputs: [{ address: "tb1qrecipient", amount: 10000 }],
    inputPaths: ["m/48'/1'/0'/2'/0/0"],
  });
};
