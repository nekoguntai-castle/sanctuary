import {
  NotificationDeadLetterAggregateReader,
  notificationDeadLetterSnapshotSchema,
} from '../../notifications/deadLetterAggregates';
import { registerShareableCollector } from './registry';

registerShareableCollector('notificationDeadLetters', {
  collect: () => new NotificationDeadLetterAggregateReader().read(),
  schema: notificationDeadLetterSnapshotSchema,
  sourceProcess: 'redis_shared',
  sourceKind: 'rolling_aggregate',
  authoritativeFor: ['worker_delivery_aggregates'],
  notAuthoritativeFor: ['worker_delivery'],
});
