import { vi } from 'vitest';

const policyRepositoryPrismaMock = vi.hoisted(() => ({
  vaultPolicy: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    count: vi.fn(),
  },
  approvalRequest: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    count: vi.fn(),
  },
  approvalVote: {
    create: vi.fn(),
    findUnique: vi.fn(),
  },
  policyEvent: {
    create: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
  },
  policyAddress: {
    findMany: vi.fn(),
    create: vi.fn(),
    delete: vi.fn(),
    findUnique: vi.fn(),
  },
  policyUsageWindow: {
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
}));

vi.mock('../../../../src/models/prisma', () => ({
  __esModule: true,
  default: policyRepositoryPrismaMock,
}));

const prisma = policyRepositoryPrismaMock;

export const setupPolicyRepositoryMocks = () => {
  vi.clearAllMocks();
};

export { prisma };
export type { Mock } from 'vitest';
