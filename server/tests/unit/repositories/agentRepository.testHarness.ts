import { vi } from 'vitest';

const mockPrisma = vi.hoisted(() => ({
  walletAgent: {
    create: vi.fn(),
    findMany: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  agentApiKey: {
    create: vi.fn(),
    findMany: vi.fn(),
    findUnique: vi.fn(),
    groupBy: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
  agentFundingAttempt: {
    create: vi.fn(),
    count: vi.fn(),
  },
  agentFundingOverride: {
    create: vi.fn(),
    findMany: vi.fn(),
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
  agentAlert: {
    create: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    groupBy: vi.fn(),
  },
  draftTransaction: {
    aggregate: vi.fn(),
    findMany: vi.fn(),
    groupBy: vi.fn(),
  },
  transaction: {
    findMany: vi.fn(),
  },
  uTXO: {
    groupBy: vi.fn(),
  },
  $queryRaw: vi.fn(),
  $transaction: vi.fn(),
}));

vi.mock('../../../src/models/prisma', () => ({
  __esModule: true,
  default: mockPrisma,
}));

import * as agentRepositoryModule from '../../../src/repositories/agentRepository';

export const prisma = mockPrisma;
export const agentRepository = agentRepositoryModule;

export function resetAgentRepositoryMocks() {
  vi.clearAllMocks();
  prisma.$transaction.mockImplementation(
    async (fn: (client: typeof prisma) => unknown) => fn(prisma),
  );
  prisma.$queryRaw.mockResolvedValue([{ pg_advisory_xact_lock: '' }]);
}
