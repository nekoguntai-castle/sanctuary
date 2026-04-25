import { beforeEach, vi } from 'vitest';
import type { Job } from 'bullmq';
import type {
  TransactionNotifyJobData,
  DraftNotifyJobData,
  ConfirmationNotifyJobData,
  ConsolidationSuggestionNotifyJobData,
} from '../../../../src/worker/jobs/types';

const mockPrisma = {
  draftTransaction: {
    findUnique: vi.fn(),
  },
  transaction: {
    findFirst: vi.fn(),
  },
};

const mockNotificationChannelRegistry = {
  notifyTransactions: vi.fn(),
  notifyDraft: vi.fn(),
  notifyConsolidationSuggestion: vi.fn(),
  getConsolidationSuggestionCapable: vi.fn(),
};

const mockNotificationJobResultsTotal = {
  inc: vi.fn(),
};

vi.resetModules();

vi.doMock('../../../../src/utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.doMock('../../../../src/models/prisma', () => ({
  default: mockPrisma,
}));

vi.doMock('../../../../src/repositories', () => ({
  draftRepository: {
    findById: (id: string) => mockPrisma.draftTransaction.findUnique({ where: { id } }),
  },
  transactionRepository: {
    findByTxid: (txid: string, walletId: string) => mockPrisma.transaction.findFirst({ where: { txid, walletId } }),
  },
  walletRepository: {
    getName: vi.fn().mockResolvedValue('Test Wallet'),
  },
}));

vi.doMock('../../../../src/services/notifications/channels', () => ({
  notificationChannelRegistry: mockNotificationChannelRegistry,
}));

vi.doMock('../../../../src/observability/metrics/infrastructureMetrics', () => ({
  notificationJobResultsTotal: mockNotificationJobResultsTotal,
}));

export type {
  TransactionNotifyJobData,
  DraftNotifyJobData,
  ConfirmationNotifyJobData,
  ConsolidationSuggestionNotifyJobData,
};

export {
  mockPrisma,
  mockNotificationChannelRegistry,
  mockNotificationJobResultsTotal,
};

export function createMockJob<T>(data: T, opts?: Partial<Job<T>>): Job<T> {
  return {
    id: 'test-job-id',
    data,
    attemptsMade: 0,
    opts: { attempts: 5 },
    ...opts,
  } as Job<T>;
}

export function registerNotificationJobBeforeEach(): void {
  beforeEach(() => {
    vi.clearAllMocks();
    mockNotificationChannelRegistry.getConsolidationSuggestionCapable.mockReturnValue([
      { id: 'telegram' },
    ]);
  });
}
