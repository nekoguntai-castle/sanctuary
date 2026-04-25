import { vi } from 'vitest';
import type { Express } from 'express';
import type { PrismaClient } from '../../../src/generated/prisma/client';

export let app: Express;
export let prisma: PrismaClient;

export function setAuthIntegrationContext(nextApp: Express, nextPrisma: PrismaClient): void {
  app = nextApp;
  prisma = nextPrisma;
}

export function mockElectrumForAuthIntegration(): void {
  vi.doMock('../../../src/services/bitcoin/electrum', () => ({
    getElectrumClient: vi.fn().mockResolvedValue({
      connect: vi.fn().mockResolvedValue(undefined),
      isConnected: vi.fn().mockReturnValue(true),
      blockchainScripthash_getBalance: vi.fn().mockResolvedValue({ confirmed: 0, unconfirmed: 0 }),
      blockchainScripthash_listunspent: vi.fn().mockResolvedValue([]),
      blockchainScripthash_getHistory: vi.fn().mockResolvedValue([]),
    }),
  }));
}
