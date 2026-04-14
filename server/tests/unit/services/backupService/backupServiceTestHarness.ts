import { vi } from 'vitest';
import { mockPrismaClient } from '../../../mocks/prisma';

vi.mock('../../../../src/models/prisma', () => ({
  __esModule: true,
  default: mockPrismaClient,
}));

vi.mock('../../../../src/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('../../../../src/services/migrationService', () => ({
  migrationService: {
    getSchemaVersion: vi.fn().mockResolvedValue(1),
  },
  getExpectedSchemaVersion: vi.fn().mockReturnValue(1),
}));

vi.mock('../../../../src/utils/encryption', () => ({
  isEncrypted: vi.fn().mockReturnValue(false),
  decrypt: vi.fn().mockImplementation((v) => v),
}));
