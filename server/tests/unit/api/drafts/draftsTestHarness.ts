import { vi } from 'vitest';
import { mockPrismaClient, resetPrismaMocks } from '../../../mocks/prisma';

const draftApiMocks = vi.hoisted(() => ({
  mockWalletService: {
    getWalletById: vi.fn(),
    checkWalletAccess: vi.fn().mockResolvedValue(true),
  },
  mockDraftLockService: {
    lockUtxosForDraft: vi.fn(),
    resolveUtxoIds: vi.fn(),
    unlockUtxosForDraft: vi.fn(),
  },
  mockNotificationService: {
    notifyNewDraft: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../../../../src/models/prisma', async () => {
  const { mockPrismaClient: prisma } = await import('../../../mocks/prisma');
  return {
    __esModule: true,
    default: prisma,
  };
});

vi.mock('../../../../src/services/wallet', () => draftApiMocks.mockWalletService);
vi.mock('../../../../src/services/draftLockService', () => draftApiMocks.mockDraftLockService);
vi.mock('../../../../src/services/notifications/notificationService', () => draftApiMocks.mockNotificationService);

export const walletService = draftApiMocks.mockWalletService;
export const draftLockService = draftApiMocks.mockDraftLockService;
export const notificationService = draftApiMocks.mockNotificationService;

export const setupDraftApiMocks = () => {
  resetPrismaMocks();
  vi.clearAllMocks();
  walletService.checkWalletAccess.mockResolvedValue(true);
  notificationService.notifyNewDraft.mockResolvedValue(undefined);
};
