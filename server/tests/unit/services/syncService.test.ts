/**
 * Sync Service Unit Tests
 *
 * Tests for wallet synchronization service including:
 * - Fail-closed compatibility entry points
 * - Lifecycle and polling-mode handling
 * - Real-time subscriptions
 */

import { describe } from 'vitest';
import { registerSyncServiceAddressMaintenanceTests } from './syncService/address-maintenance.contracts';
import { registerSyncServiceLifecycleQueueTests } from './syncService/lifecycle-queue.contracts';
import { registerSyncServicePollingModeTests } from './syncService/polling-mode.contracts';
import { registerSyncServiceRealtimeSubscriptionTests } from './syncService/realtime-subscriptions.contracts';
import { setupSyncServiceTestHooks, type SyncServiceTestContext } from './syncService/syncServiceTestHarness';

describe('SyncService', () => {
  const context: SyncServiceTestContext = setupSyncServiceTestHooks();

  registerSyncServiceLifecycleQueueTests(context);
  registerSyncServicePollingModeTests(context);
  registerSyncServiceAddressMaintenanceTests(context);
  registerSyncServiceRealtimeSubscriptionTests(context);
});
