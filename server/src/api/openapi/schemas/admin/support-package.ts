import {
  countBucket,
  notificationFailureClass,
  queueState,
  supportSection,
  telemetryWindow,
  unavailableQueueObservationState,
  workerSnapshot,
} from './support-package-shared';
import { supportNotificationWorkerFleetSchema } from './support-package-fleet';

const retentionLimit = {
  oneOf: [
    {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['count'] },
        count: { type: 'integer', minimum: 1, maximum: 10_000 },
      },
      required: ['kind', 'count'],
      additionalProperties: false,
    },
    {
      type: 'object',
      properties: { kind: { type: 'string', enum: ['immediate_removal'] } },
      required: ['kind'],
      additionalProperties: false,
    },
  ],
} as const;

const retentionFamily = {
  type: 'object',
  properties: {
    classification: { type: 'string', enum: ['uniform', 'immediate_removal'] },
    completed: retentionLimit,
    failed: retentionLimit,
    retainedAge: {
      type: 'object',
      properties: { status: { type: 'string', enum: ['unsupported'] } },
      required: ['status'],
      additionalProperties: false,
    },
  },
  required: ['classification', 'completed', 'failed', 'retainedAge'],
  additionalProperties: false,
} as const;

export const adminSupportPackageSchemas = {
  AdminSupportPackageRequest: {
    type: 'object',
    properties: {
      confirmShareableAggregate: { type: 'boolean', enum: [true] },
    },
    required: ['confirmShareableAggregate'],
    additionalProperties: false,
  },
  AdminSupportPackageBusyResponse: {
    type: 'object',
    properties: {
      error: {
        type: 'string',
        enum: ['support_package_generation_in_progress'],
      },
    },
    required: ['error'],
    additionalProperties: false,
  },
  AdminSupportPackageUnavailableResponse: {
    type: 'object',
    properties: {
      error: { type: 'string', enum: ['support_package_unavailable'] },
      message: {
        type: 'string',
        enum: ['The privacy-safe support package could not be generated.'],
      },
    },
    required: ['error', 'message'],
    additionalProperties: false,
  },
  AdminSupportPackageV2: {
    type: 'object',
    properties: {
      version: { type: 'string', enum: ['2.0.0'] },
      profile: { type: 'string', enum: ['shareable_aggregate'] },
      generatedAt: { type: 'string', format: 'date-time' },
      serverVersion: { type: 'string', maxLength: 64 },
      collectors: {
        type: 'object',
        properties: {
          config: supportSection({
            $ref: '#/components/schemas/SupportSafeConfig',
          }),
          notificationEligibility: supportSection({
            $ref: '#/components/schemas/SupportNotificationEligibility',
          }),
          notificationDeadLetters: supportSection({
            $ref: '#/components/schemas/SupportNotificationDeadLetters',
          }),
          notificationQueue: supportSection({
            $ref: '#/components/schemas/SupportNotificationQueue',
          }),
          notificationWorker: supportSection({
            $ref: '#/components/schemas/SupportNotificationWorker',
          }),
          notificationWorkerFleet: supportSection({
            $ref: '#/components/schemas/SupportNotificationWorkerFleet',
          }),
          notificationTelemetry: supportSection({
            $ref: '#/components/schemas/SupportNotificationTelemetry',
          }),
        },
        additionalProperties: false,
      },
      meta: {
        type: 'object',
        properties: {
          totalDurationMs: { type: 'integer', minimum: 0, maximum: 60_000 },
          succeeded: {
            type: 'array',
            maxItems: 32,
            items: { type: 'string', maxLength: 64 },
          },
          failed: {
            type: 'array',
            maxItems: 32,
            items: { type: 'string', maxLength: 64 },
          },
        },
        required: ['totalDurationMs', 'succeeded', 'failed'],
        additionalProperties: false,
      },
    },
    required: [
      'version',
      'profile',
      'generatedAt',
      'serverVersion',
      'collectors',
      'meta',
    ],
    additionalProperties: false,
  },
  SupportSafeConfig: {
    type: 'object',
    properties: {
      environment: {
        type: 'string',
        enum: ['development', 'production', 'test'],
      },
      bitcoinNetwork: {
        type: 'string',
        enum: ['mainnet', 'testnet3', 'testnet4', 'signet', 'regtest'],
      },
      notificationPipeline: {
        type: 'object',
        properties: {
          databaseConfigured: { type: 'boolean' },
          redisConfigured: { type: 'boolean' },
          workerHealthConfigured: { type: 'boolean' },
          electrumSubscriptionsEnabled: { type: 'boolean' },
          telegramFeatureDefaultEnabled: { type: 'boolean' },
        },
        required: [
          'databaseConfigured',
          'redisConfigured',
          'workerHealthConfigured',
          'electrumSubscriptionsEnabled',
          'telegramFeatureDefaultEnabled',
        ],
        additionalProperties: false,
      },
    },
    required: ['environment', 'bitcoinNetwork', 'notificationPipeline'],
    additionalProperties: false,
  },
  SupportNotificationEligibility: {
    oneOf: [
      {
        type: 'object',
        properties: {
          observation: { type: 'string', enum: ['observed'] },
          unit: {
            type: 'string',
            enum: ['distinct_accessible_wallets_with_eligible_recipient'],
          },
          telegramUsers: {
            type: 'object',
            properties: {
              configured: countBucket,
              enabled: countBucket,
            },
            required: ['configured', 'enabled'],
            additionalProperties: false,
          },
          eligibleWallets: {
            type: 'object',
            properties: {
              received: countBucket,
              sent: countBucket,
              draft: countBucket,
              consolidation: countBucket,
            },
            required: ['received', 'sent', 'draft', 'consolidation'],
            additionalProperties: false,
          },
          disabledDirectionWallets: {
            type: 'object',
            properties: {
              received: countBucket,
              sent: countBucket,
              draft: countBucket,
              consolidation: countBucket,
            },
            required: ['received', 'sent', 'draft', 'consolidation'],
            additionalProperties: false,
          },
          enabledUsersWithoutWalletSettings: countBucket,
          missingCredentialUsers: countBucket,
          orphanedWalletSettings: countBucket,
        },
        required: [
          'observation',
          'unit',
          'telegramUsers',
          'eligibleWallets',
          'disabledDirectionWallets',
          'enabledUsersWithoutWalletSettings',
          'missingCredentialUsers',
          'orphanedWalletSettings',
        ],
        additionalProperties: false,
      },
      {
        type: 'object',
        properties: { observation: { type: 'string', enum: ['unavailable'] } },
        required: ['observation'],
        additionalProperties: false,
      },
    ],
  },
  SupportNotificationQueue: {
    type: 'object',
    properties: {
      consistency: { type: 'string', enum: ['approximate_non_atomic'] },
      paused: {
        oneOf: [
          {
            type: 'object',
            properties: {
              status: { type: 'string', enum: ['observed'] },
              value: { type: 'boolean' },
            },
            required: ['status', 'value'],
            additionalProperties: false,
          },
          {
            type: 'object',
            properties: { status: unavailableQueueObservationState },
            required: ['status'],
            additionalProperties: false,
          },
        ],
      },
      states: {
        type: 'object',
        properties: {
          waiting: queueState,
          active: queueState,
          delayed: queueState,
          failed: queueState,
          completed: queueState,
          prioritized: queueState,
          waitingChildren: queueState,
        },
        required: [
          'waiting',
          'active',
          'delayed',
          'failed',
          'completed',
          'prioritized',
          'waitingChildren',
        ],
        additionalProperties: false,
      },
      retention: {
        type: 'object',
        properties: {
          contractVersion: { type: 'integer', enum: [1] },
          producerCompatibility: { type: 'string', enum: ['unknown'] },
          families: {
            type: 'object',
            properties: {
              transaction: retentionFamily,
              draft: retentionFamily,
              consolidation: retentionFamily,
              webhook: retentionFamily,
            },
            required: ['transaction', 'draft', 'consolidation', 'webhook'],
            additionalProperties: false,
          },
        },
        required: ['contractVersion', 'producerCompatibility', 'families'],
        additionalProperties: false,
      },
    },
    required: ['consistency', 'paused', 'states', 'retention'],
    additionalProperties: false,
  },
  SupportNotificationWorker: {
    oneOf: [
      {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['observed'] },
          value: workerSnapshot,
        },
        required: ['status', 'value'],
        additionalProperties: false,
      },
      {
        type: 'object',
        properties: { status: unavailableQueueObservationState },
        required: ['status'],
        additionalProperties: false,
      },
    ],
  },
  SupportNotificationTelemetry: {
    type: 'object',
    properties: {
      version: { type: 'integer', enum: [1] },
      localWriter: {
        oneOf: [
          {
            type: 'object',
            properties: {
              observation: { type: 'string', enum: ['observed'] },
              circuit: { type: 'string', enum: ['closed', 'open'] },
              droppedEvents: countBucket,
            },
            required: ['observation', 'circuit', 'droppedEvents'],
            additionalProperties: false,
          },
          {
            type: 'object',
            properties: { observation: { type: 'string', enum: ['unavailable'] } },
            required: ['observation'],
            additionalProperties: false,
          },
        ],
      },
      windows: {
        type: 'object',
        properties: {
          fiveMinutes: telemetryWindow,
          oneHour: telemetryWindow,
          twentyFourHours: telemetryWindow,
        },
        required: ['fiveMinutes', 'oneHour', 'twentyFourHours'],
        additionalProperties: false,
      },
    },
    required: ['version', 'localWriter', 'windows'],
    additionalProperties: false,
  },
  SupportNotificationDeadLetters: {
    type: 'object',
    properties: {
      version: { type: 'integer', enum: [1] },
      observation: { type: 'string', enum: ['observed', 'unavailable', 'timeout'] },
      coverage: { type: 'string', enum: ['degraded', 'unavailable'] },
      retention: {
        type: 'object',
        properties: {
          window: { type: 'string', enum: ['seven_days'] },
          counts: { type: 'string', enum: ['best_effort_exhaustion_attempt'] },
          duplicateCallbacks: { type: 'string', enum: ['may_increment'] },
          retryClaimRemovalEffect: {
            type: 'string',
            enum: ['historical_event_retained_until_expiry'],
          },
        },
        required: ['window', 'counts', 'duplicateCallbacks', 'retryClaimRemovalEffect'],
        additionalProperties: false,
      },
      records: {
        type: 'array',
        maxItems: 128,
        items: {
          type: 'object',
          properties: {
            jobFamily: {
              type: 'string',
              enum: ['transaction', 'draft', 'confirmation', 'consolidation', 'other'],
            },
            failureClass: notificationFailureClass,
            attempts: {
              type: 'string',
              enum: ['unknown', 'one', 'two_to_three', 'four_to_five', 'six_plus'],
            },
            count: { type: 'integer', minimum: 0, maximum: 1_000_000 },
            saturated: { type: 'boolean' },
            lastSeenAge: {
              type: 'string',
              enum: [
                'lt_one_hour',
                'one_to_six_hours',
                'six_to_twenty_four_hours',
                'one_to_three_days',
                'three_to_seven_days',
              ],
            },
          },
          required: [
            'jobFamily',
            'failureClass',
            'attempts',
            'count',
            'saturated',
            'lastSeenAge',
          ],
          additionalProperties: false,
        },
      },
      truncated: { type: 'boolean' },
      droppedDimensionBucket: countBucket,
    },
    required: [
      'version',
      'observation',
      'coverage',
      'retention',
      'records',
      'truncated',
      'droppedDimensionBucket',
    ],
    additionalProperties: false,
  },
  SupportNotificationWorkerFleet: supportNotificationWorkerFleetSchema,
} as const;
