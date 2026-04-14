import { beforeEach, vi } from 'vitest';
import { faker } from '@faker-js/faker';

const approvalMocks = vi.hoisted(() => ({
  mockLog: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
  mockPolicyRepo: {
    findPolicyById: vi.fn(),
    findApprovalRequestById: vi.fn(),
    findApprovalRequestsByDraftId: vi.fn(),
    findPendingApprovalsForUser: vi.fn(),
    createApprovalRequest: vi.fn(),
    updateApprovalRequestStatus: vi.fn(),
    createVote: vi.fn(),
    findVoteByUserAndRequest: vi.fn(),
    createPolicyEvent: vi.fn().mockResolvedValue({}),
  },
  mockDraftRepo: {
    findById: vi.fn(),
    update: vi.fn(),
    updateApprovalStatus: vi.fn().mockResolvedValue(undefined),
  },
  mockNotify: {
    notifyApprovalRequested: vi.fn().mockResolvedValue(undefined),
    notifyApprovalResolved: vi.fn().mockResolvedValue(undefined),
  },
}));

export const mockLog = approvalMocks.mockLog;
export const mockPolicyRepo = approvalMocks.mockPolicyRepo;
export const mockDraftRepo = approvalMocks.mockDraftRepo;
export const mockNotify = approvalMocks.mockNotify;

vi.mock('../../../../src/utils/logger', () => ({
  createLogger: () => mockLog,
}));

vi.mock('../../../../src/utils/errors', () => ({
  getErrorMessage: (err: unknown) => (err instanceof Error ? err.message : String(err)),
}));

vi.mock('../../../../src/repositories/policyRepository', () => ({
  policyRepository: mockPolicyRepo,
}));

vi.mock('../../../../src/repositories/draftRepository', () => ({
  draftRepository: mockDraftRepo,
}));

vi.mock('../../../../src/models/prisma', () => ({
  __esModule: true,
  default: {},
}));

vi.mock('../../../../src/services/vaultPolicy/approvalNotifications', () => mockNotify);

export const walletId = faker.string.uuid();
export const userId = faker.string.uuid();
export const draftId = faker.string.uuid();
export const policyId = faker.string.uuid();
export const requestId = faker.string.uuid();
export const otherUserId = faker.string.uuid();

export function makePendingRequest(overrides: Record<string, unknown> = {}) {
  return {
    id: requestId,
    draftTransactionId: draftId,
    policyId,
    status: 'pending',
    requiredApprovals: 2,
    quorumType: 'any_n',
    allowSelfApproval: false,
    expiresAt: null,
    votes: [],
    ...overrides,
  };
}

export function registerApprovalServiceTestHarness() {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPolicyRepo.createPolicyEvent.mockResolvedValue({});
    mockDraftRepo.updateApprovalStatus.mockResolvedValue(undefined);
    mockNotify.notifyApprovalRequested.mockResolvedValue(undefined);
    mockNotify.notifyApprovalResolved.mockResolvedValue(undefined);
  });
}
