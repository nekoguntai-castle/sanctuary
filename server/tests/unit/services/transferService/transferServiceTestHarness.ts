import { vi } from 'vitest';
import { resetPrismaMocks } from '../../../mocks/prisma';

const transferServiceMocks = vi.hoisted(() => ({
  mockCheckWalletOwnerAccess: vi.fn(),
  mockCheckDeviceOwnerAccess: vi.fn(),
}));

vi.mock('../../../../src/models/prisma', async () => {
  const { mockPrismaClient: prisma } = await import('../../../mocks/prisma');
  return {
    __esModule: true,
    default: prisma,
  };
});

vi.mock('../../../../src/utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock('../../../../src/services/wallet', () => ({
  checkWalletOwnerAccess: transferServiceMocks.mockCheckWalletOwnerAccess,
}));

vi.mock('../../../../src/services/deviceAccess', () => ({
  checkDeviceOwnerAccess: transferServiceMocks.mockCheckDeviceOwnerAccess,
}));

export const ownerId = 'owner-123';
export const recipientId = 'recipient-456';
export const walletId = 'wallet-789';
export const deviceId = 'device-abc';
export const transferId = 'transfer-xyz';

export const mockCheckWalletOwnerAccess = transferServiceMocks.mockCheckWalletOwnerAccess;
export const mockCheckDeviceOwnerAccess = transferServiceMocks.mockCheckDeviceOwnerAccess;

export const setupTransferServiceMocks = () => {
  resetPrismaMocks();
  vi.clearAllMocks();
  mockCheckWalletOwnerAccess.mockResolvedValue(true);
  mockCheckDeviceOwnerAccess.mockResolvedValue(true);
};
