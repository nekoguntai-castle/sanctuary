import { readNotificationQueue } from '../../../infrastructure/workerQueueReader';
import { registerShareableCollector } from './registry';
import { notificationQueueSchema } from './notificationRuntimeSchemas';

registerShareableCollector('notificationQueue', {
  collect: async () => ({ ...await readNotificationQueue() }),
  schema: notificationQueueSchema,
  sourceProcess: 'redis_shared',
  sourceKind: 'queue_getters',
  authoritativeFor: ['notification_queue'],
  notAuthoritativeFor: ['worker_notification_capability', 'worker_delivery'],
});
