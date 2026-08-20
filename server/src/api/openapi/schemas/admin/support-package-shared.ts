const countBucket = {
  type: 'string',
  enum: ['zero', 'one', 'two_to_five', 'six_to_twenty', 'over_twenty'],
} as const;
const unavailableQueueObservationState = {
  type: 'string',
  enum: ['unavailable', 'timeout', 'unsupported'],
} as const;
const queueAgeBucket = {
  type: 'string',
  enum: [
    'none',
    'not_due',
    'lt_1m',
    'one_to_five_minutes',
    'five_minutes_to_one_hour',
    'one_to_twenty_four_hours',
    'gte_twenty_four_hours',
  ],
} as const;
const queueCountObservation = {
  oneOf: [
    {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['observed'] },
        value: {
          type: 'object',
          properties: {
            value: { type: 'integer', minimum: 0, maximum: 1_000_000 },
            saturated: { type: 'boolean' },
          },
          required: ['value', 'saturated'],
          additionalProperties: false,
        },
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
} as const;
const queueAgeObservation = {
  oneOf: [
    {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['observed'] },
        value: queueAgeBucket,
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
} as const;
const queueState = {
  type: 'object',
  properties: { count: queueCountObservation, oldestAge: queueAgeObservation },
  required: ['count', 'oldestAge'],
  additionalProperties: false,
} as const;
const workerCountBucket = {
  type: 'string',
  enum: ['0', '1', '2-5', '6-20', '21-100', '101+'],
} as const;
const workerAgeBucket = {
  type: 'string',
  enum: ['never', '<1m', '1m-15m', '15m-1h', '1h-24h', '1d+'],
} as const;
const notificationFailureClass = {
  type: 'string',
  enum: [
    'none',
    'invalid_configuration',
    'authentication',
    'permission',
    'rate_limited',
    'provider_rejected',
    'provider_unavailable',
    'timeout',
    'circuit_open',
    'network',
    'redis_unavailable',
    'queue_add_failed',
    'internal',
    'unknown',
    'other',
  ],
} as const;
const telegramFailureClass = {
  type: 'string',
  enum: [
    'none',
    'invalid_configuration',
    'authentication',
    'permission',
    'rate_limited',
    'provider_rejected',
    'provider_unavailable',
    'timeout',
    'circuit_open',
    'network',
    'unknown',
    'other',
  ],
} as const;
const workerSnapshot = {
  type: 'object',
  properties: {
    protocolVersion: { type: 'integer', enum: [1] },
    sampledAt: { type: 'string', format: 'date-time' },
    worker: {
      type: 'object',
      properties: {
        readiness: { type: 'string', enum: ['ready', 'degraded'] },
        uptime: {
          ...workerAgeBucket,
          enum: ['<1m', '1m-15m', '15m-1h', '1h-24h', '1d+'],
        },
        concurrency: workerCountBucket,
      },
      required: ['readiness', 'uptime', 'concurrency'],
      additionalProperties: false,
    },
    notificationPipeline: {
      type: 'object',
      properties: {
        consumerRunning: { type: 'boolean' },
        transactionHandlerRegistered: { type: 'boolean' },
      },
      required: ['consumerRunning', 'transactionHandlerRegistered'],
      additionalProperties: false,
    },
    redis: {
      type: 'object',
      properties: {
        state: { type: 'string', enum: ['connected', 'disconnected'] },
      },
      required: ['state'],
      additionalProperties: false,
    },
    database: {
      type: 'object',
      properties: {
        state: { type: 'string', enum: ['connected', 'disconnected', 'unknown'] },
      },
      required: ['state'],
      additionalProperties: false,
    },
    electrum: {
      type: 'object',
      properties: {
        managerRunning: { type: 'boolean' },
        connected: { type: 'boolean' },
        subscriptionOwner: { type: 'boolean' },
        subscribedAddresses: workerCountBucket,
      },
      required: [
        'managerRunning',
        'connected',
        'subscriptionOwner',
        'subscribedAddresses',
      ],
      additionalProperties: false,
    },
    telegram: {
      type: 'object',
      properties: {
        circuitState: {
          type: 'string',
          enum: ['closed', 'half-open', 'open', 'not-registered'],
        },
        failures: workerCountBucket,
        totalRequests: workerCountBucket,
        lastFailureAge: workerAgeBucket,
        lastSuccessAge: workerAgeBucket,
        lastFailureClass: telegramFailureClass,
      },
      required: [
        'circuitState',
        'failures',
        'totalRequests',
        'lastFailureAge',
        'lastSuccessAge',
        'lastFailureClass',
      ],
      additionalProperties: false,
    },
    notificationTelemetryWriter: {
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
  },
  required: [
    'protocolVersion',
    'sampledAt',
    'worker',
    'notificationPipeline',
    'redis',
    'database',
    'electrum',
    'telegram',
    'notificationTelemetryWriter',
  ],
  additionalProperties: false,
} as const;
const telemetryRecord = {
  type: 'object',
  properties: {
    family: { type: 'string', enum: ['transaction'] },
    stage: {
      type: 'string',
      enum: [
        'enqueue_resolved',
        'enqueue_failed',
        'handler_started',
        'transport_attempted',
        'inline_fallback_attempted',
        'inline_terminal_outcome',
        'attempt_failed',
        'transport_accepted',
        'terminal_completed',
        'terminal_failure',
      ],
    },
    source: { type: 'string', enum: ['api', 'worker'] },
    path: { type: 'string', enum: ['queued', 'inline'] },
    channel: { type: 'string', enum: ['none', 'telegram', 'push', 'other'] },
    outcome: {
      type: 'string',
      enum: [
        'none',
        'not_registered',
        'no_recipients',
        'accepted',
        'rejected',
        'partial',
        'ambiguous',
      ],
    },
    failureClass: notificationFailureClass,
    count: { type: 'integer', minimum: 0, maximum: 1_000_000 },
    saturated: { type: 'boolean' },
  },
  required: [
    'family',
    'stage',
    'source',
    'path',
    'channel',
    'outcome',
    'failureClass',
    'count',
    'saturated',
  ],
  additionalProperties: false,
} as const;
const telemetryObservationAge = {
  type: 'string',
  enum: [
    'none',
    'within_one_minute',
    'within_five_minutes',
    'within_one_hour',
    'within_six_hours',
    'within_twenty_four_hours',
  ],
} as const;
const telemetrySourceAttendance = {
  oneOf: [
    {
      type: 'object',
      properties: {
        observation: { type: 'string', enum: ['observed'] },
        attendance: { type: 'string', enum: ['none', 'partial', 'full'] },
        observedBuckets: countBucket,
        attestedEmitterCount: countBucket,
        oldestObservationAge: telemetryObservationAge,
        newestObservationAge: telemetryObservationAge,
      },
      required: [
        'observation',
        'attendance',
        'observedBuckets',
        'attestedEmitterCount',
        'oldestObservationAge',
        'newestObservationAge',
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
} as const;
const telemetryWindow = {
  type: 'object',
  properties: {
    observation: {
      type: 'string',
      enum: ['observed', 'unavailable', 'timeout'],
    },
    coverage: { type: 'string', enum: ['degraded', 'unavailable'] },
    records: { type: 'array', maxItems: 256, items: telemetryRecord },
    truncated: { type: 'boolean' },
    droppedDimensionBucket: countBucket,
    sources: {
      type: 'object',
      properties: {
        api: telemetrySourceAttendance,
        worker: telemetrySourceAttendance,
      },
      required: ['api', 'worker'],
      additionalProperties: false,
    },
  },
  required: [
    'observation',
    'coverage',
    'records',
    'truncated',
    'droppedDimensionBucket',
    'sources',
  ],
  additionalProperties: false,
} as const;
const supportPackageAuthority = {
  type: 'string',
  enum: [
    'static_notification_configuration',
    'effective_notification_configuration',
    'notification_queue',
    'worker_notification_capability',
    'worker_delivery_aggregates',
    'worker_delivery',
    'wallet_sync_state',
    'wallet_full_resync_intent',
    'wallet_sync_execution',
  ],
} as const;
const provenance = {
  type: 'object',
  properties: {
    collectorProcess: { type: 'string', enum: ['api'] },
    sourceProcess: {
      type: 'string',
      enum: ['api', 'worker', 'redis_shared', 'database_shared'],
    },
    sourceKind: {
      type: 'string',
      enum: [
        'static_configuration',
        'effective_configuration',
        'aggregate_query',
        'direct_worker_probe',
        'queue_getters',
        'rolling_aggregate',
      ],
    },
    sampledAt: { type: 'string', format: 'date-time' },
    dataAsOf: { type: 'string', format: 'date-time' },
    observationWindow: { type: 'string', enum: ['point_in_time'] },
    authoritativeFor: {
      type: 'array',
      maxItems: 16,
      items: supportPackageAuthority,
    },
    notAuthoritativeFor: {
      type: 'array',
      maxItems: 16,
      items: supportPackageAuthority,
    },
  },
  required: [
    'collectorProcess',
    'sourceProcess',
    'sourceKind',
    'sampledAt',
    'dataAsOf',
    'observationWindow',
    'authoritativeFor',
    'notAuthoritativeFor',
  ],
  additionalProperties: false,
} as const;

function supportSection(dataSchema: Record<string, unknown>) {
  const baseProperties = {
    durationMs: { type: 'integer', minimum: 0, maximum: 60_000 },
    truncated: { type: 'boolean' },
    droppedCount: { type: 'integer', minimum: 0, maximum: 1_000_000 },
    provenance,
  } as const;
  return {
    oneOf: [
      {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['ok'] },
          ...baseProperties,
          data: dataSchema,
        },
        required: [
          'status',
          'durationMs',
          'truncated',
          'droppedCount',
          'provenance',
          'data',
        ],
        additionalProperties: false,
      },
      {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['error'] },
          ...baseProperties,
          error: {
            type: 'string',
            enum: [
              'timeout',
              'unavailable',
              'privacy_policy_violation',
              'internal_error',
            ],
          },
        },
        required: [
          'status',
          'durationMs',
          'truncated',
          'droppedCount',
          'provenance',
          'error',
        ],
        additionalProperties: false,
      },
    ],
  } as const;
}

export {
  countBucket,
  notificationFailureClass,
  queueState,
  supportSection,
  telemetryWindow,
  telegramFailureClass,
  unavailableQueueObservationState,
  workerAgeBucket,
  workerCountBucket,
  workerSnapshot,
};
