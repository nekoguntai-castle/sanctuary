import { beforeAll, beforeEach, vi } from 'vitest';
import { faker } from '@faker-js/faker';

const vaultPolicyMocks = vi.hoisted(() => ({
  mockLog: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
  mockTx: { _tx: true },
  mockPolicyRepo: {
    withTransaction: vi.fn(),
    findPoliciesByWalletId: vi.fn(),
    findAllPoliciesForWallet: vi.fn(),
    findSystemPolicies: vi.fn(),
    findGroupPolicies: vi.fn(),
    findPolicyById: vi.fn(),
    findPolicyByIdInWallet: vi.fn(),
    createPolicy: vi.fn(),
    updatePolicy: vi.fn(),
    removePolicy: vi.fn(),
    findPendingDraftIdsWithApprovalRequestsForPolicy: vi.fn().mockResolvedValue([]),
    countPoliciesByWalletId: vi.fn(),
    findPolicyEvents: vi.fn(),
    findPolicyAddresses: vi.fn(),
    createPolicyAddress: vi.fn(),
    findPolicyAddressById: vi.fn(),
    removePolicyAddress: vi.fn(),
  },
  mockDraftRepo: {
    lockDraftsForUpdate: vi.fn().mockResolvedValue([]),
  },
  mockWalletRepo: {
    findById: vi.fn(),
    findNetwork: vi.fn(),
  },
  mockApprovalService: {
    rederiveDraftApprovalStatus: vi.fn().mockResolvedValue(undefined),
  },
}));

export const mockLog = vaultPolicyMocks.mockLog;
export const mockTx = vaultPolicyMocks.mockTx;
export const mockPolicyRepo = vaultPolicyMocks.mockPolicyRepo;
export const mockDraftRepo = vaultPolicyMocks.mockDraftRepo;
export const mockWalletRepo = vaultPolicyMocks.mockWalletRepo;
export const mockApprovalService = vaultPolicyMocks.mockApprovalService;

vi.mock('../../../../src/utils/logger', () => ({
  createLogger: () => vaultPolicyMocks.mockLog,
}));

vi.mock('../../../../src/repositories/policyRepository', () => ({
  policyRepository: vaultPolicyMocks.mockPolicyRepo,
}));

vi.mock('../../../../src/repositories/draftRepository', () => ({
  draftRepository: vaultPolicyMocks.mockDraftRepo,
}));

vi.mock('../../../../src/repositories/walletRepository', () => ({
  walletRepository: vaultPolicyMocks.mockWalletRepo,
}));

vi.mock('../../../../src/services/vaultPolicy/approvalService', () => ({
  approvalService: vaultPolicyMocks.mockApprovalService,
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
    mockPolicyRepo.withTransaction.mockImplementation(
      (operation: (tx: unknown) => Promise<unknown>) => operation(mockTx)
    );
    mockPolicyRepo.findPendingDraftIdsWithApprovalRequestsForPolicy.mockResolvedValue([]);
    mockDraftRepo.lockDraftsForUpdate.mockResolvedValue([]);
    mockWalletRepo.findNetwork.mockResolvedValue('testnet');
  });
}
