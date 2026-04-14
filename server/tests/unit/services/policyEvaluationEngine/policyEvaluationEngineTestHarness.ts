import { beforeAll, beforeEach, vi } from 'vitest';
import { faker } from '@faker-js/faker';

const { mockLog, mockPolicyRepo, mockWalletRepo, mockVaultPolicyService } = vi.hoisted(() => ({
  mockLog: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
  mockPolicyRepo: {
    findOrCreateUsageWindow: vi.fn(),
    incrementUsageWindow: vi.fn().mockResolvedValue(undefined),
    findPolicyAddresses: vi.fn(),
    createPolicyEvent: vi.fn().mockResolvedValue({}),
  },
  mockWalletRepo: {
    findById: vi.fn(),
  },
  mockVaultPolicyService: {
    getActivePoliciesForWallet: vi.fn(),
  },
}));

vi.mock('../../../../src/utils/logger', () => ({
  createLogger: () => mockLog,
}));

vi.mock('../../../../src/repositories/policyRepository', () => ({
  policyRepository: mockPolicyRepo,
}));

vi.mock('../../../../src/repositories/walletRepository', () => ({
  walletRepository: mockWalletRepo,
}));

vi.mock('../../../../src/services/vaultPolicy/vaultPolicyService', () => ({
  vaultPolicyService: mockVaultPolicyService,
}));

type PolicyEvaluationEngine = typeof import(
  '../../../../src/services/vaultPolicy/policyEvaluationEngine'
).policyEvaluationEngine;

let policyEvaluationEngine: PolicyEvaluationEngine;

export interface PolicyEvaluationEngineTestContext {
  walletId: string;
  userId: string;
  groupId: string;
  recipient: string;
}

export function makePolicy(overrides: Record<string, unknown>) {
  return {
    id: faker.string.uuid(),
    name: 'Test Policy',
    type: 'spending_limit',
    config: {},
    enforcement: 'enforce',
    enabled: true,
    priority: 0,
    sourceType: 'wallet',
    walletId: faker.string.uuid(),
    groupId: null,
    createdBy: faker.string.uuid(),
    createdAt: new Date(),
    updatedAt: new Date(),
    updatedBy: null,
    description: null,
    ...overrides,
  };
}

export function setupPolicyEvaluationEngineTestHooks(): PolicyEvaluationEngineTestContext {
  const context = {
    walletId: faker.string.uuid(),
    userId: faker.string.uuid(),
    groupId: faker.string.uuid(),
    recipient: 'bc1qtest123456789',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockWalletRepo.findById.mockResolvedValue({ id: context.walletId, groupId: null });
  });

  beforeAll(async () => {
    const module = await import('../../../../src/services/vaultPolicy/policyEvaluationEngine');
    policyEvaluationEngine = module.policyEvaluationEngine;
  });

  return context;
}

export function getPolicyEvaluationEngine(): PolicyEvaluationEngine {
  return policyEvaluationEngine;
}

export {
  mockLog,
  mockPolicyRepo,
  mockWalletRepo,
  mockVaultPolicyService,
};
