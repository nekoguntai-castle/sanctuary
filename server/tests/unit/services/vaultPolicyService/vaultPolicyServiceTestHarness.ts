import { beforeAll, beforeEach, vi } from 'vitest';
import { faker } from '@faker-js/faker';

const vaultPolicyMocks = vi.hoisted(() => ({
  mockLog: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
  mockPolicyRepo: {
    findPoliciesByWalletId: vi.fn(),
    findAllPoliciesForWallet: vi.fn(),
    findSystemPolicies: vi.fn(),
    findGroupPolicies: vi.fn(),
    findPolicyById: vi.fn(),
    findPolicyByIdInWallet: vi.fn(),
    createPolicy: vi.fn(),
    updatePolicy: vi.fn(),
    removePolicy: vi.fn(),
    countPoliciesByWalletId: vi.fn(),
    findPolicyEvents: vi.fn(),
    findPolicyAddresses: vi.fn(),
    createPolicyAddress: vi.fn(),
    findPolicyAddressById: vi.fn(),
    removePolicyAddress: vi.fn(),
  },
  mockWalletRepo: {
    findById: vi.fn(),
  },
}));

export const mockLog = vaultPolicyMocks.mockLog;
export const mockPolicyRepo = vaultPolicyMocks.mockPolicyRepo;
export const mockWalletRepo = vaultPolicyMocks.mockWalletRepo;

vi.mock('../../../../src/utils/logger', () => ({
  createLogger: () => vaultPolicyMocks.mockLog,
}));

vi.mock('../../../../src/repositories/policyRepository', () => ({
  policyRepository: vaultPolicyMocks.mockPolicyRepo,
}));

vi.mock('../../../../src/repositories/walletRepository', () => ({
  walletRepository: vaultPolicyMocks.mockWalletRepo,
}));

type VaultPolicyService = typeof import(
  '../../../../src/services/vaultPolicy/vaultPolicyService'
).vaultPolicyService;

export let vaultPolicyService: VaultPolicyService;

export const userId = faker.string.uuid();
export const walletId = faker.string.uuid();
export const groupId = faker.string.uuid();
export const policyId = faker.string.uuid();

export function registerVaultPolicyServiceTestHarness(): void {
  beforeAll(async () => {
    ({ vaultPolicyService } = await import('../../../../src/services/vaultPolicy/vaultPolicyService'));
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });
}
