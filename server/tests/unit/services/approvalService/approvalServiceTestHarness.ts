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
    resolveApprovalRequestIfPending: vi.fn(),
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
  mockWalletSharingRepo: {
    findWalletUsersWithUsername: vi.fn(),
  },
}));

export const mockLog = approvalMocks.mockLog;
export const mockPolicyRepo = approvalMocks.mockPolicyRepo;
export const mockDraftRepo = approvalMocks.mockDraftRepo;
export const mockNotify = approvalMocks.mockNotify;
export const mockWalletSharingRepo = approvalMocks.mockWalletSharingRepo;

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

vi.mock('../../../../src/repositories/walletSharingRepository', () => ({
  walletSharingRepository: mockWalletSharingRepo,
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

export function makeWalletUser(walletUserId: string, role: string) {
  return { id: faker.string.uuid(), walletId, userId: walletUserId, role, user: { id: walletUserId, username: walletUserId } };
}

export function registerApprovalServiceTestHarness() {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default to winning the conditional resolution. Tests that exercise the
    // lost-race path override this with `null`, which is what the repository
    // returns when the request was no longer pending at write time.
    mockPolicyRepo.resolveApprovalRequestIfPending.mockImplementation(
      async (id: string, status: string) => ({ id, status })
    );
    mockPolicyRepo.createPolicyEvent.mockResolvedValue({});
    mockDraftRepo.updateApprovalStatus.mockResolvedValue(undefined);
    mockNotify.notifyApprovalRequested.mockResolvedValue(undefined);
    mockNotify.notifyApprovalResolved.mockResolvedValue(undefined);
    // Default to no wallet members so 'all'-quorum paths that don't set up
    // membership explicitly resolve to an empty eligible set rather than
    // throwing on an unmocked call.
    mockWalletSharingRepo.findWalletUsersWithUsername.mockResolvedValue([]);
  });
}
