import {
  telegramFailureClass,
  workerAgeBucket,
  workerCountBucket,
} from './support-package-shared';

const fleetAge = {
  ...workerAgeBucket,
  enum: [...workerAgeBucket.enum, 'mixed_or_unknown'],
} as const;

export const supportNotificationWorkerFleetSchema = {
  oneOf: [
    {
      type: 'object',
      properties: {
        version: { type: 'integer', enum: [1] },
        observation: { type: 'string', enum: ['observed'] },
        coverage: { type: 'string', enum: ['complete', 'degraded'] },
        workerCount: workerCountBucket,
        oldestHeartbeatAge: workerAgeBucket,
        restartObserved: { type: 'boolean' },
        notificationConsumer: {
          type: 'string',
          enum: ['all_running', 'none_running', 'mixed_or_unknown'],
        },
        transactionHandler: {
          type: 'string',
          enum: ['all_running', 'none_running', 'mixed_or_unknown'],
        },
        telemetryWriterCircuit: {
          type: 'string',
          enum: ['all_closed', 'any_open', 'mixed_or_unknown'],
        },
        telemetryDroppedEvents: {
          type: 'string',
          enum: ['none', 'some', 'mixed_or_unknown'],
        },
        telegramCircuit: {
          type: 'string',
          enum: ['all_closed', 'any_open', 'any_half_open', 'mixed_or_unknown'],
        },
        telegramLastSuccessAge: fleetAge,
        telegramLastFailureAge: fleetAge,
        telegramFailureClass: {
          type: 'string',
          enum: [...telegramFailureClass.enum, 'mixed_or_unknown'],
        },
        retentionContract: {
          type: 'string',
          enum: ['uniform', 'mixed_version', 'unknown'],
        },
      },
      required: [
        'version',
        'observation',
        'coverage',
        'workerCount',
        'oldestHeartbeatAge',
        'restartObserved',
        'notificationConsumer',
        'transactionHandler',
        'telemetryWriterCircuit',
        'telemetryDroppedEvents',
        'telegramCircuit',
        'telegramLastSuccessAge',
        'telegramLastFailureAge',
        'telegramFailureClass',
        'retentionContract',
      ],
      additionalProperties: false,
    },
    {
      type: 'object',
      properties: {
        version: { type: 'integer', enum: [1] },
        observation: { type: 'string', enum: ['unavailable', 'timeout'] },
        coverage: { type: 'string', enum: ['unavailable'] },
      },
      required: ['version', 'observation', 'coverage'],
      additionalProperties: false,
    },
  ],
} as const;
