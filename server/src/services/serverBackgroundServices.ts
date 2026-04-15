/**
 * Server background service lifecycle wiring.
 *
 * Keep lifecycle ownership out of the HTTP entrypoint so service ordering,
 * retries, and shutdown behavior stay testable.
 */

import { notificationService } from '../websocket/notifications';
import { registerService } from './serviceRegistry';
import { initializeRevocationService, shutdownRevocationService } from './tokenRevocation';
import { getSyncService } from './syncService';
import { startWorkerHealthMonitor, stopWorkerHealthMonitor } from './workerHealth';

export function registerServerBackgroundServices(): void {
  registerService({
    name: 'token-revocation',
    start: async () => {
      initializeRevocationService();
    },
    stop: () => shutdownRevocationService(),
    critical: false,
    maxRetries: 1,
    backoffMs: [1000],
  });

  registerService({
    name: 'notifications',
    start: () => notificationService.start(),
    stop: () => notificationService.stop(),
    critical: false,
    maxRetries: 2,
    backoffMs: [1000, 3000],
  });

  registerService({
    name: 'worker-heartbeat',
    start: () => startWorkerHealthMonitor(),
    stop: () => stopWorkerHealthMonitor(),
    critical: true,
    maxRetries: 10,
    backoffMs: [1000, 2000, 5000, 10000],
  });

  const syncService = getSyncService();
  registerService({
    name: 'sync',
    start: () => syncService.start(),
    stop: () => syncService.stop(),
    critical: false,
    dependsOn: ['worker-heartbeat'],
    maxRetries: 3,
    backoffMs: [2000, 5000, 10000],
  });
}
