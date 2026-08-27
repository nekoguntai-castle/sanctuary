import { requestWorkerDiagnostics } from '../../workerDiagnosticsClient';
import { registerShareableCollector } from './registry';
import { notificationWorkerSchema } from './notificationRuntimeSchemas';

registerShareableCollector('notificationWorker', {
  collect: () => requestWorkerDiagnostics(),
  schema: notificationWorkerSchema,
  sourceProcess: 'worker',
  sourceKind: 'direct_worker_probe',
  authoritativeFor: ['worker_notification_capability', 'wallet_sync_execution'],
  notAuthoritativeFor: [
    'notification_queue',
    'effective_notification_configuration',
    'wallet_sync_state',
    'wallet_incremental_sync_intent',
    'wallet_full_resync_intent',
    'wallet_sync_lease_row',
  ],
});
