import { afterAll, beforeAll, beforeEach, describe, vi } from 'vitest';
/**
 * Wallet Lifecycle Integration Tests
 *
 * Tests the complete wallet lifecycle:
 * - Create wallets (single-sig, multi-sig)
 * - Get wallet details
 * - Update wallet settings
 * - Add/remove devices from wallet
 * - Delete wallet
 * - Wallet access permissions (owner, viewer, signer roles)
 *
 * Requires a running PostgreSQL database.
 * Set DATABASE_URL or TEST_DATABASE_URL environment variable.
 *
 * Run with: npm run test:integration
 */

import { setupTestDatabase, cleanupTestData, teardownTestDatabase, canRunIntegrationTests } from '../setup/testDatabase';
import { createTestApp, resetTestApp } from '../setup/testServer';
import { registerWalletAccessStatsImportTests } from './wallet/access-stats-import.contracts';
import { registerWalletCoreCrudTests } from './wallet/core-crud.contracts';
import { registerWalletDevicesSharingTests } from './wallet/devices-sharing.contracts';
import { registerWalletGroupsTelegramTests } from './wallet/groups-telegram.contracts';
import { setWalletIntegrationContext } from './wallet/walletIntegrationTestHarness';

// Increase timeout for integration tests
vi.setConfig(30000);

// Skip all tests if no database is available
const describeWithDb = canRunIntegrationTests() ? describe : describe.skip;

describeWithDb('Wallet Lifecycle Integration', () => {
  beforeAll(async () => {
    // Mock external services before importing routes
    vi.doMock('../../../src/services/bitcoin/electrum', () => ({
      getElectrumClient: vi.fn().mockResolvedValue({
        connect: vi.fn().mockResolvedValue(undefined),
        isConnected: vi.fn().mockReturnValue(true),
        blockchainScripthash_getBalance: vi.fn().mockResolvedValue({ confirmed: 0, unconfirmed: 0 }),
        blockchainScripthash_listunspent: vi.fn().mockResolvedValue([]),
        blockchainScripthash_getHistory: vi.fn().mockResolvedValue([]),
      }),
    }));

    const prisma = await setupTestDatabase();
    const app = createTestApp();
    setWalletIntegrationContext(app, prisma);
  });

  afterAll(async () => {
    resetTestApp();
    await teardownTestDatabase();
    vi.restoreAllMocks();
  });

  beforeEach(async () => {
    await cleanupTestData();
  });

  registerWalletCoreCrudTests();
  registerWalletDevicesSharingTests();
  registerWalletAccessStatsImportTests();
  registerWalletGroupsTelegramTests();
});
