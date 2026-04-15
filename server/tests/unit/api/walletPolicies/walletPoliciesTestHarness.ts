import express, { type Express } from 'express';
import request from 'supertest';
import { beforeAll, beforeEach, vi } from 'vitest';

const walletPolicyMocks = vi.hoisted(() => ({
  mockListWalletPolicies: vi.fn(),
  mockGetWalletPolicyEvents: vi.fn(),
  mockGetPolicyInWallet: vi.fn(),
  mockCreatePolicy: vi.fn(),
  mockUpdatePolicy: vi.fn(),
  mockDeletePolicy: vi.fn(),
  mockEvaluatePolicies: vi.fn(),
  mockListPolicyAddressesInWallet: vi.fn(),
  mockCreatePolicyAddressInWallet: vi.fn(),
  mockRemovePolicyAddressFromWallet: vi.fn(),
  mockLogFromRequest: vi.fn(),
}));

vi.mock('../../../../src/middleware/walletAccess', () => ({
  requireWalletAccess: () => (req: any, _res: any, next: () => void) => {
    req.wallet = { id: 'wallet-1', userRole: 'owner' };
    next();
  },
}));

vi.mock('../../../../src/services/vaultPolicy', () => ({
  vaultPolicyService: {
    listWalletPolicies: walletPolicyMocks.mockListWalletPolicies,
    getWalletPolicyEvents: walletPolicyMocks.mockGetWalletPolicyEvents,
    getPolicyInWallet: walletPolicyMocks.mockGetPolicyInWallet,
    createPolicy: walletPolicyMocks.mockCreatePolicy,
    updatePolicy: walletPolicyMocks.mockUpdatePolicy,
    deletePolicy: walletPolicyMocks.mockDeletePolicy,
    listPolicyAddressesInWallet: walletPolicyMocks.mockListPolicyAddressesInWallet,
    createPolicyAddressInWallet: walletPolicyMocks.mockCreatePolicyAddressInWallet,
    removePolicyAddressFromWallet: walletPolicyMocks.mockRemovePolicyAddressFromWallet,
  },
  policyEvaluationEngine: {
    evaluatePolicies: walletPolicyMocks.mockEvaluatePolicies,
  },
}));

vi.mock('../../../../src/services/auditService', () => ({
  auditService: {
    logFromRequest: walletPolicyMocks.mockLogFromRequest,
  },
  AuditAction: {
    POLICY_CREATE: 'wallet.policy_create',
    POLICY_UPDATE: 'wallet.policy_update',
    POLICY_DELETE: 'wallet.policy_delete',
  },
  AuditCategory: {
    WALLET: 'wallet',
  },
}));

vi.mock('../../../../src/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('../../../../src/utils/errors', () => ({
  getErrorMessage: (err: unknown) => (err instanceof Error ? err.message : String(err)),
}));

let app: Express;

export const mockListWalletPolicies = walletPolicyMocks.mockListWalletPolicies;
export const mockGetWalletPolicyEvents = walletPolicyMocks.mockGetWalletPolicyEvents;
export const mockGetPolicyInWallet = walletPolicyMocks.mockGetPolicyInWallet;
export const mockCreatePolicy = walletPolicyMocks.mockCreatePolicy;
export const mockUpdatePolicy = walletPolicyMocks.mockUpdatePolicy;
export const mockDeletePolicy = walletPolicyMocks.mockDeletePolicy;
export const mockEvaluatePolicies = walletPolicyMocks.mockEvaluatePolicies;
export const mockListPolicyAddressesInWallet = walletPolicyMocks.mockListPolicyAddressesInWallet;
export const mockCreatePolicyAddressInWallet = walletPolicyMocks.mockCreatePolicyAddressInWallet;
export const mockRemovePolicyAddressFromWallet = walletPolicyMocks.mockRemovePolicyAddressFromWallet;
export const mockLogFromRequest = walletPolicyMocks.mockLogFromRequest;

export function setupWalletPoliciesTestHarness(): void {
  beforeAll(async () => {
    const [routerModule, errorHandlerModule] = await Promise.all([
      import('../../../../src/api/wallets/policies'),
      import('../../../../src/errors/errorHandler'),
    ]);

    app = express();
    app.use(express.json());
    app.use((req: any, _res, next) => {
      req.user = { userId: 'user-1', username: 'alice', isAdmin: false };
      next();
    });
    app.use('/api/v1/wallets', routerModule.default);
    app.use(errorHandlerModule.errorHandler);
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockLogFromRequest.mockResolvedValue(undefined);
  });
}

export function walletPoliciesRequest(): ReturnType<typeof request> {
  return request(app);
}
