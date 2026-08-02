import { NotificationTelemetryReader } from '../../notifications/telemetryReader';
import { notificationTelemetrySnapshotSchema } from '../../notifications/telemetryReader';
import { registerShareableCollector } from './registry';

registerShareableCollector('notificationTelemetry', {
  collect: () => new NotificationTelemetryReader().read(),
  schema: notificationTelemetrySnapshotSchema,
  sourceProcess: 'redis_shared',
  sourceKind: 'rolling_aggregate',
  authoritativeFor: ['worker_delivery_aggregates'],
  notAuthoritativeFor: ['worker_delivery'],
});
