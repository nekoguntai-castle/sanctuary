import { requestWorkerDiagnostics } from '../../workerDiagnosticsClient';
import { registerShareableCollector } from './registry';
import { notificationWorkerSchema } from './notificationRuntimeSchemas';

registerShareableCollector('notificationWorker', {
  collect: () => requestWorkerDiagnostics(),
  schema: notificationWorkerSchema,
  sourceProcess: 'worker',
  sourceKind: 'direct_worker_probe',
  authoritativeFor: ['worker_notification_capability'],
  notAuthoritativeFor: ['notification_queue', 'effective_notification_configuration'],
});
