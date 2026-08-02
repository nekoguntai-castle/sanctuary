const selectorProperties = {
  txid: { type: 'string', pattern: '^[0-9a-fA-F]{64}$' },
  senderWalletId: { type: 'string', minLength: 1, maxLength: 128 },
  receiverWalletId: { type: 'string', minLength: 1, maxLength: 128 },
  approximateIncidentTime: { type: 'string', format: 'date-time' },
} as const;

const evidenceBoolean = {
  type: 'string',
  enum: ['observed_true', 'observed_false', 'not_observed', 'not_applicable'],
} as const;
const timing = {
  type: 'string',
  enum: ['predates_incident', 'within_window', 'postdates_incident', 'unknown', 'not_applicable'],
} as const;
const age = {
  type: 'string',
  enum: [
    'lt_1m', 'one_to_five_minutes', 'five_minutes_to_one_hour',
    'one_to_twenty_four_hours', 'gte_twenty_four_hours', 'not_observed', 'not_applicable',
  ],
} as const;
const outcome = {
  type: 'string',
  enum: [
    'not_registered', 'no_recipients', 'accepted', 'rejected',
    'partial', 'ambiguous', 'not_observed',
  ],
} as const;
const failureClass = {
  type: 'string',
  enum: [
    'none', 'invalid_configuration', 'authentication', 'permission', 'rate_limited',
    'provider_rejected', 'provider_unavailable', 'timeout', 'circuit_open', 'network',
    'redis_unavailable', 'queue_add_failed', 'internal', 'unknown', 'other', 'not_observed',
  ],
} as const;

const transactionRow = {
  type: 'object',
  properties: {
    lookupStatus: { type: 'string', enum: ['observed', 'unavailable'] },
    present: evidenceBoolean,
    directionMatches: evidenceBoolean,
    timing,
  },
  required: ['lookupStatus', 'present', 'directionMatches', 'timing'],
  additionalProperties: false,
} as const;
const receiverMatch = {
  type: 'object',
  properties: {
    ownsSelectedOutput: evidenceBoolean,
    networkMatches: evidenceBoolean,
    addressTiming: timing,
  },
  required: ['ownsSelectedOutput', 'networkMatches', 'addressTiming'],
  additionalProperties: false,
} as const;
const eligibility = {
  type: 'object',
  properties: {
    evidenceSource: { type: 'string', enum: ['capture_time', 'current_snapshot', 'not_observed'] },
    coverage: { type: 'string', enum: ['none', 'some', 'all', 'unknown'] },
  },
  required: ['evidenceSource', 'coverage'],
  additionalProperties: false,
} as const;
const notificationJob = {
  type: 'object',
  properties: {
    lookupStatus: { type: 'string', enum: ['observed', 'unavailable', 'timeout'] },
    presence: { type: 'string', enum: ['observed_true', 'not_retained', 'not_observed'] },
    state: {
      type: 'string',
      enum: [
        'waiting', 'active', 'delayed', 'failed', 'completed', 'prioritized',
        'waiting_children', 'unknown', 'not_observed',
      ],
    },
    attempts: {
      type: 'string',
      enum: ['none', 'one', 'two_to_three', 'four_to_five', 'six_plus', 'unknown'],
    },
    enqueue: { type: 'string', enum: ['resolved', 'failed', 'not_observed'] },
    handler: { type: 'string', enum: ['started', 'not_started', 'not_observed'] },
    terminal: { type: 'string', enum: ['completed', 'failed', 'not_terminal', 'not_observed'] },
    telegram: {
      type: 'object',
      properties: { outcome, failureClass },
      required: ['outcome', 'failureClass'],
      additionalProperties: false,
    },
    ages: {
      type: 'object',
      properties: { created: age, processed: age, finished: age },
      required: ['created', 'processed', 'finished'],
      additionalProperties: false,
    },
    retention: {
      type: 'object',
      properties: {
        record: { type: 'string', enum: ['retained', 'not_retained', 'not_observed'] },
        horizon: { type: 'string', enum: ['unsupported'] },
        saturation: { type: 'string', enum: ['unknown'] },
      },
      required: ['record', 'horizon', 'saturation'],
      additionalProperties: false,
    },
  },
  required: [
    'lookupStatus', 'presence', 'state', 'attempts', 'enqueue', 'handler',
    'terminal', 'telegram', 'ages', 'retention',
  ],
  additionalProperties: false,
} as const;

function roleSchema(role: 'sender' | 'receiver', expectedDirection: 'sent' | 'received') {
  return {
    type: 'object',
    properties: {
      role: { type: 'string', enum: [role] },
      expectedDirection: { type: 'string', enum: [expectedDirection] },
      transactionRow,
      receiverMatch,
      eligibility,
      notificationJob,
    },
    required: [
      'role', 'expectedDirection', 'transactionRow', 'receiverMatch',
      'eligibility', 'notificationJob',
    ],
    additionalProperties: false,
  } as const;
}

const captureStatus = {
  type: 'object',
  properties: {
    state: { type: 'string', enum: ['inactive', 'arming', 'ready', 'partial', 'invalid', 'tearing_down'] },
    expiresIn: {
      type: 'string',
      enum: ['under_1_minute', '1_to_5_minutes', '5_to_10_minutes', '10_to_15_minutes'],
    },
    failure: {
      type: 'string',
      enum: [
        'coordination_unavailable', 'session_busy', 'session_expired', 'membership_mismatch',
        'session_invalid', 'selector_unavailable', 'teardown_failed',
      ],
    },
  },
  required: ['state'],
  additionalProperties: false,
} as const;

export const adminSupportPackageIncidentSchemas = {
  AdminIncidentSupportPackageRequest: {
    type: 'object',
    properties: { ...selectorProperties, confirmIncidentProfile: { type: 'boolean', enum: [true] } },
    required: [...Object.keys(selectorProperties), 'confirmIncidentProfile'],
    additionalProperties: false,
  },
  AdminIncidentCaptureArmRequest: {
    type: 'object',
    properties: { ...selectorProperties, confirmIncidentCapture: { type: 'boolean', enum: [true] } },
    required: [...Object.keys(selectorProperties), 'confirmIncidentCapture'],
    additionalProperties: false,
  },
  AdminIncidentCaptureTeardownRequest: {
    type: 'object',
    properties: { confirmIncidentCaptureTeardown: { type: 'boolean', enum: [true] } },
    required: ['confirmIncidentCaptureTeardown'],
    additionalProperties: false,
  },
  AdminIncidentCaptureStatus: captureStatus,
  AdminIncidentProfileUnavailableResponse: {
    type: 'object',
    properties: {
      error: { type: 'string', enum: ['incident_profile_unavailable'] },
      message: { type: 'string', enum: ['The privacy-safe incident profile could not be generated.'] },
    },
    required: ['error', 'message'],
    additionalProperties: false,
  },
  AdminIncidentCaptureErrorResponse: {
    type: 'object',
    properties: {
      error: { type: 'string', enum: ['incident_capture_unavailable'] },
      message: { type: 'string', enum: ['The controlled incident capture service is unavailable.'] },
    },
    required: ['error', 'message'],
    additionalProperties: false,
  },
  AdminIncidentCaptureUnavailableResponse: {
    oneOf: [
      { $ref: '#/components/schemas/AdminIncidentCaptureStatus' },
      { $ref: '#/components/schemas/AdminIncidentCaptureErrorResponse' },
    ],
  },
  SupportIncidentSenderEvidence: roleSchema('sender', 'sent'),
  SupportIncidentReceiverEvidence: roleSchema('receiver', 'received'),
  AdminIncidentSupportPackageV1: {
    type: 'object',
    properties: {
      version: { type: 'string', enum: ['1.0.0'] },
      profile: { type: 'string', enum: ['single_incident'] },
      generatedAt: { type: 'string', format: 'date-time' },
      serverVersion: { type: 'string', minLength: 1, maxLength: 64 },
      collectors: {
        type: 'object',
        properties: {
          incident: {
            type: 'object',
            properties: {
              status: { type: 'string', enum: ['ok'] },
              durationMs: { type: 'integer', minimum: 0, maximum: 60_000 },
              truncated: { type: 'boolean', enum: [false] },
              droppedCount: { type: 'integer', enum: [0] },
              provenance: {
                type: 'object',
                properties: {
                  collectorProcess: { type: 'string', enum: ['api'] },
                  sourceProcess: { type: 'string', enum: ['api'] },
                  sourceKind: { type: 'string', enum: ['incident_correlation'] },
                  sampledAt: { type: 'string', format: 'date-time' },
                  dataAsOf: { type: 'string', format: 'date-time' },
                  observationWindow: { type: 'string', enum: ['point_in_time'] },
                },
                required: ['collectorProcess', 'sourceProcess', 'sourceKind', 'sampledAt', 'dataAsOf', 'observationWindow'],
                additionalProperties: false,
              },
              data: {
                type: 'object',
                properties: {
                  sender: { $ref: '#/components/schemas/SupportIncidentSenderEvidence' },
                  receiver: { $ref: '#/components/schemas/SupportIncidentReceiverEvidence' },
                  captureCoverage: { type: 'string', enum: ['not_observed', 'partial', 'complete', 'invalid'] },
                },
                required: ['sender', 'receiver', 'captureCoverage'],
                additionalProperties: false,
              },
            },
            required: ['status', 'durationMs', 'truncated', 'droppedCount', 'provenance', 'data'],
            additionalProperties: false,
          },
        },
        required: ['incident'],
        additionalProperties: false,
      },
      meta: {
        type: 'object',
        properties: {
          privacyValidation: { type: 'string', enum: ['passed'] },
          totalDurationMs: { type: 'integer', minimum: 0, maximum: 60_000 },
        },
        required: ['privacyValidation', 'totalDurationMs'],
        additionalProperties: false,
      },
    },
    required: ['version', 'profile', 'generatedAt', 'serverVersion', 'collectors', 'meta'],
    additionalProperties: false,
  },
} as const;
