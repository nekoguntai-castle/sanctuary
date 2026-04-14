/**
 * Sync Service Unit Tests
 *
 * Tests for wallet synchronization service including:
 * - Queue management
 * - Concurrent sync handling
 * - Retry logic
 * - Error handling
 * - Real-time subscriptions
 */

import { describe } from 'vitest';
import { registerSyncServiceAddressMaintenanceTests } from './syncService/address-maintenance.contracts';
import { registerSyncServiceErrorHandlingTests } from './syncService/error-handling.contracts';
import { registerSyncServiceExecutionRetryPollingTests } from './syncService/execution-retry-polling.contracts';
import { registerSyncServiceLifecycleQueueTests } from './syncService/lifecycle-queue.contracts';
import { registerSyncServiceRealtimeSubscriptionTests } from './syncService/realtime-subscriptions.contracts';
import { setupSyncServiceTestHooks, type SyncServiceTestContext } from './syncService/syncServiceTestHarness';

describe('SyncService', () => {
  const context: SyncServiceTestContext = setupSyncServiceTestHooks();

  registerSyncServiceLifecycleQueueTests(context);
  registerSyncServiceExecutionRetryPollingTests(context);
  registerSyncServiceAddressMaintenanceTests(context);
  registerSyncServiceRealtimeSubscriptionTests(context);
});

registerSyncServiceErrorHandlingTests();
