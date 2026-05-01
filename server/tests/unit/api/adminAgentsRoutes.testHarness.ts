import express, { type Express } from "express";
import { vi } from "vitest";
import { errorHandler } from "../../../src/errors/errorHandler";
import { configureDefaultAdminAgentRouteMocks } from "./admin-agents-routes.fixtures";

const mockState = vi.hoisted(() => ({
  agentRepository: {
    findAgents: vi.fn(),
    createAgent: vi.fn(),
    findAgentById: vi.fn(),
    findAgentByIdWithDetails: vi.fn(),
    updateAgent: vi.fn(),
    findDashboardRows: vi.fn(),
    findAlerts: vi.fn(),
    findFundingOverrides: vi.fn(),
    createFundingOverride: vi.fn(),
    findFundingOverrideById: vi.fn(),
    revokeFundingOverride: vi.fn(),
    findApiKeysByAgentId: vi.fn(),
    createApiKey: vi.fn(),
    findApiKeyById: vi.fn(),
    revokeApiKey: vi.fn(),
  },
  userRepository: {
    findById: vi.fn(),
    findAllSummary: vi.fn(),
  },
  walletRepository: {
    findById: vi.fn(),
    findByIdWithSigningDevices: vi.fn(),
    hasAccess: vi.fn(),
    findAllWithSelect: vi.fn(),
  },
  logFromRequest: vi.fn(),
}));

export const mocks = mockState;

vi.mock("../../../src/middleware/auth", () => ({
  authenticate: (req: any, _res: any, next: () => void) => {
    req.user = { userId: "admin-1", username: "admin", isAdmin: true };
    next();
  },
  requireAdmin: (_req: any, _res: any, next: () => void) => next(),
}));

vi.mock("../../../src/repositories", () => ({
  agentRepository: mockState.agentRepository,
  userRepository: mockState.userRepository,
  walletRepository: mockState.walletRepository,
}));

vi.mock("../../../src/services/auditService", () => ({
  AuditAction: {
    AGENT_CREATE: "wallet.agent_create",
    AGENT_UPDATE: "wallet.agent_update",
    AGENT_REVOKE: "wallet.agent_revoke",
    AGENT_KEY_CREATE: "wallet.agent_key_create",
    AGENT_KEY_REVOKE: "wallet.agent_key_revoke",
    AGENT_OVERRIDE_CREATE: "wallet.agent_override_create",
    AGENT_OVERRIDE_REVOKE: "wallet.agent_override_revoke",
  },
  AuditCategory: {
    WALLET: "wallet",
  },
  auditService: {
    logFromRequest: mockState.logFromRequest,
  },
}));

import agentsRouter from "../../../src/api/admin/agents";

export const createAdminAgentsRouteTestApp = (): Express => {
  const app = express();
  app.use(express.json());
  app.use("/api/v1/admin/agents", agentsRouter);
  app.use(errorHandler);
  return app;
};

export const resetAdminAgentsRouteMocks = () => {
  vi.clearAllMocks();
  configureDefaultAdminAgentRouteMocks(mocks);
};
