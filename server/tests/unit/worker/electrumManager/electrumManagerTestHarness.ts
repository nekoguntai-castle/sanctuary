/**
 * ElectrumSubscriptionManager Tests
 *
 * Tests for the Electrum subscription manager, particularly
 * the reconcileSubscriptions method that handles memory cleanup.
 */

import { afterEach, beforeEach, vi } from 'vitest';
import { EventEmitter } from 'events';

// Mock prisma before importing the module
vi.mock('../../../../src/models/prisma', () => ({
  default: {
    address: {
      findMany: vi.fn(),
    },
    wallet: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock('../../../../src/repositories', async () => {
  const prismaModule = await import('../../../../src/models/prisma');
  const prisma = prismaModule.default;
  return {
    walletRepository: {
      findNetwork: vi.fn().mockResolvedValue(null),
      findById: vi.fn().mockResolvedValue(null),
    },
    addressRepository: {
      findAddressStrings: vi.fn().mockResolvedValue([]),
      findByWalletId: vi.fn().mockResolvedValue([]),
      findAllWithWalletNetworkPaginated: (opts: { take: number; cursor?: string }) =>
        prisma.address.findMany({
          select: { id: true, address: true, walletId: true, wallet: { select: { network: true } } },
          take: opts.take,
          skip: opts.cursor ? 1 : 0,
          cursor: opts.cursor ? { id: opts.cursor } : undefined,
          orderBy: { id: 'asc' },
        }),
      findAllWithWalletNetwork: () => prisma.address.findMany({ select: { address: true, walletId: true } }),
    },
  };
});

// Mock the electrum client
vi.mock('../../../../src/services/bitcoin/electrum', () => ({
  getElectrumClientForNetwork: vi.fn(),
  closeAllElectrumClients: vi.fn(),
}));

// Mock config
vi.mock('../../../../src/config', () => ({
  getConfig: vi.fn(() => ({
    bitcoin: { network: 'mainnet' },
  })),
}));

// Mock blockchain
vi.mock('../../../../src/services/bitcoin/blockchain', () => ({
  setCachedBlockHeight: vi.fn(),
}));

vi.mock('../../../../src/utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock('../../../../src/infrastructure', () => ({
  acquireLock: vi.fn(),
  extendLock: vi.fn(),
  releaseLock: vi.fn(),
}));

import { getElectrumClientForNetwork } from '../../../../src/services/bitcoin/electrum';
import { ElectrumSubscriptionManager } from '../../../../src/worker/electrumManager';
import type { ElectrumManagerCallbacks } from '../../../../src/worker/electrumManager/types';

export class MockElectrumClient extends EventEmitter {
  connect = vi.fn().mockResolvedValue(undefined);
  getServerVersion = vi.fn().mockResolvedValue({ server: 'test', protocol: '1.4' });
  subscribeHeaders = vi.fn().mockResolvedValue({ height: 100000, hex: '00'.repeat(80) });
  subscribeAddress = vi.fn().mockResolvedValue('status');
  subscribeAddressBatch = vi.fn().mockResolvedValue([]);
}

export let manager: ElectrumSubscriptionManager;
export let mockClient: MockElectrumClient;
export const mockCallbacks: ElectrumManagerCallbacks = {
  onNewBlock: vi.fn(),
  onAddressActivity: vi.fn(),
};

export function registerElectrumManagerSetup() {
  beforeEach(() => {
    vi.clearAllMocks();
    mockClient = new MockElectrumClient();
    vi.mocked(getElectrumClientForNetwork).mockReturnValue(mockClient as unknown as any);
    manager = new ElectrumSubscriptionManager(mockCallbacks);
  });

  afterEach(async () => {
    await manager.stop();
  });
}
