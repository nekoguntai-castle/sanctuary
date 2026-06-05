import {
  VALID_ENFORCEMENT_MODES,
  VALID_POLICY_TYPES,
  VALID_SOURCE_TYPES,
  VALID_VOTE_DECISIONS,
} from '../../../services/vaultPolicy/types';

const POLICY_CONFIG_SCHEMA_REFS = [
  { $ref: '#/components/schemas/SpendingLimitPolicyConfig' },
  { $ref: '#/components/schemas/ApprovalRequiredPolicyConfig' },
  { $ref: '#/components/schemas/TimeDelayPolicyConfig' },
  { $ref: '#/components/schemas/AddressControlPolicyConfig' },
  { $ref: '#/components/schemas/VelocityPolicyConfig' },
] as const;

const POLICY_CREATE_SCHEMA_VARIANTS = [
  {
    required: ['type', 'config'],
    properties: {
      type: { type: 'string', enum: ['spending_limit'] },
      config: { $ref: '#/components/schemas/SpendingLimitPolicyConfig' },
    },
  },
  {
    required: ['type', 'config'],
    properties: {
      type: { type: 'string', enum: ['approval_required'] },
      config: { $ref: '#/components/schemas/ApprovalRequiredPolicyConfig' },
    },
  },
  {
    required: ['type', 'config'],
    properties: {
      type: { type: 'string', enum: ['time_delay'] },
      config: { $ref: '#/components/schemas/TimeDelayPolicyConfig' },
    },
  },
  {
    required: ['type', 'config'],
    properties: {
      type: { type: 'string', enum: ['address_control'] },
      config: { $ref: '#/components/schemas/AddressControlPolicyConfig' },
    },
  },
  {
    required: ['type', 'config'],
    properties: {
      type: { type: 'string', enum: ['velocity'] },
      config: { $ref: '#/components/schemas/VelocityPolicyConfig' },
    },
  },
] as const;

export const walletPolicySchemas = {
  SpendingLimitPolicyConfig: {
    type: 'object',
    properties: {
      perTransaction: { type: 'integer', minimum: 0 },
      daily: { type: 'integer', minimum: 0 },
      weekly: { type: 'integer', minimum: 0 },
      monthly: { type: 'integer', minimum: 0 },
      scope: { type: 'string', enum: ['wallet', 'per_user'] },
      exemptRoles: { type: 'array', items: { type: 'string', minLength: 1 } },
    },
    required: ['scope'],
    additionalProperties: false,
    anyOf: [
      { required: ['perTransaction'], properties: { perTransaction: { type: 'integer', minimum: 1 } } },
      { required: ['daily'], properties: { daily: { type: 'integer', minimum: 1 } } },
      { required: ['weekly'], properties: { weekly: { type: 'integer', minimum: 1 } } },
      { required: ['monthly'], properties: { monthly: { type: 'integer', minimum: 1 } } },
    ],
  },
  ApprovalRequiredPolicyConfig: {
    type: 'object',
    properties: {
      trigger: {
        type: 'object',
        properties: {
          always: { type: 'boolean' },
          amountAbove: { type: 'integer', minimum: 1 },
          unknownAddressesOnly: { type: 'boolean' },
        },
        additionalProperties: false,
        anyOf: [
          { required: ['always'], properties: { always: { type: 'boolean', enum: [true] } } },
          { required: ['amountAbove'] },
          { required: ['unknownAddressesOnly'], properties: { unknownAddressesOnly: { type: 'boolean', enum: [true] } } },
        ],
      },
      requiredApprovals: { type: 'integer', minimum: 1 },
      quorumType: { type: 'string', enum: ['any_n', 'specific', 'all'] },
      specificApprovers: { type: 'array', items: { type: 'string', minLength: 1 } },
      allowSelfApproval: { type: 'boolean' },
      expirationHours: { type: 'integer', minimum: 0 },
    },
    required: ['trigger', 'requiredApprovals', 'quorumType', 'allowSelfApproval', 'expirationHours'],
    additionalProperties: false,
    anyOf: [
      { properties: { quorumType: { type: 'string', enum: ['any_n', 'all'] } } },
      {
        required: ['specificApprovers'],
        properties: {
          quorumType: { type: 'string', enum: ['specific'] },
          specificApprovers: { type: 'array', items: { type: 'string', minLength: 1 }, minItems: 1 },
        },
      },
    ],
  },
  TimeDelayPolicyConfig: {
    type: 'object',
    properties: {
      trigger: {
        type: 'object',
        properties: {
          always: { type: 'boolean' },
          amountAbove: { type: 'integer', minimum: 1 },
        },
        additionalProperties: false,
        anyOf: [
          { required: ['always'], properties: { always: { type: 'boolean', enum: [true] } } },
          { required: ['amountAbove'] },
        ],
      },
      delayHours: { type: 'number', minimum: 0, exclusiveMinimum: true, maximum: 168 },
      vetoEligible: { type: 'string', enum: ['any_approver', 'specific'] },
      specificVetoers: { type: 'array', items: { type: 'string', minLength: 1 } },
      notifyOnStart: { type: 'boolean' },
      notifyOnVeto: { type: 'boolean' },
      notifyOnClear: { type: 'boolean' },
    },
    required: ['trigger', 'delayHours', 'vetoEligible', 'notifyOnStart', 'notifyOnVeto', 'notifyOnClear'],
    additionalProperties: false,
    anyOf: [
      { properties: { vetoEligible: { type: 'string', enum: ['any_approver'] } } },
      {
        required: ['specificVetoers'],
        properties: {
          vetoEligible: { type: 'string', enum: ['specific'] },
          specificVetoers: { type: 'array', items: { type: 'string', minLength: 1 }, minItems: 1 },
        },
      },
    ],
  },
  AddressControlPolicyConfig: {
    type: 'object',
    properties: {
      mode: { type: 'string', enum: ['allowlist', 'denylist'] },
      allowSelfSend: { type: 'boolean' },
      managedBy: { type: 'string', enum: ['owner_only', 'approvers'] },
    },
    required: ['mode', 'allowSelfSend', 'managedBy'],
    additionalProperties: false,
  },
  VelocityPolicyConfig: {
    type: 'object',
    properties: {
      maxPerHour: { type: 'integer', minimum: 0 },
      maxPerDay: { type: 'integer', minimum: 0 },
      maxPerWeek: { type: 'integer', minimum: 0 },
      scope: { type: 'string', enum: ['wallet', 'per_user'] },
      exemptRoles: { type: 'array', items: { type: 'string', minLength: 1 } },
    },
    required: ['scope'],
    additionalProperties: false,
    anyOf: [
      { required: ['maxPerHour'], properties: { maxPerHour: { type: 'integer', minimum: 1 } } },
      { required: ['maxPerDay'], properties: { maxPerDay: { type: 'integer', minimum: 1 } } },
      { required: ['maxPerWeek'], properties: { maxPerWeek: { type: 'integer', minimum: 1 } } },
    ],
  },
  VaultPolicy: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      walletId: { type: 'string', nullable: true },
      groupId: { type: 'string', nullable: true },
      name: { type: 'string' },
      description: { type: 'string', nullable: true },
      type: { type: 'string', enum: [...VALID_POLICY_TYPES] },
      config: { type: 'object', additionalProperties: true },
      priority: { type: 'integer' },
      enforcement: { type: 'string', enum: [...VALID_ENFORCEMENT_MODES] },
      enabled: { type: 'boolean' },
      sourceType: { type: 'string', enum: [...VALID_SOURCE_TYPES] },
      createdAt: { type: 'string', format: 'date-time' },
      updatedAt: { type: 'string', format: 'date-time' },
    },
    required: ['id', 'name', 'type', 'config', 'priority', 'enforcement', 'enabled'],
  },
  VaultPolicyListResponse: {
    type: 'object',
    properties: {
      policies: {
        type: 'array',
        items: { $ref: '#/components/schemas/VaultPolicy' },
      },
    },
    required: ['policies'],
  },
  VaultPolicyResponse: {
    type: 'object',
    properties: {
      policy: { $ref: '#/components/schemas/VaultPolicy' },
    },
    required: ['policy'],
  },
  CreateVaultPolicyRequest: {
    type: 'object',
    properties: {
      name: { type: 'string' },
      description: { type: 'string', nullable: true },
      type: { type: 'string', enum: [...VALID_POLICY_TYPES] },
      config: { oneOf: POLICY_CONFIG_SCHEMA_REFS },
      priority: { type: 'integer' },
      enforcement: { type: 'string', enum: [...VALID_ENFORCEMENT_MODES] },
      enabled: { type: 'boolean' },
    },
    required: ['name', 'type', 'config'],
    additionalProperties: false,
    oneOf: POLICY_CREATE_SCHEMA_VARIANTS,
  },
  UpdateVaultPolicyRequest: {
    type: 'object',
    properties: {
      name: { type: 'string' },
      description: { type: 'string', nullable: true },
      config: { oneOf: POLICY_CONFIG_SCHEMA_REFS },
      priority: { type: 'integer' },
      enforcement: { type: 'string', enum: [...VALID_ENFORCEMENT_MODES] },
      enabled: { type: 'boolean' },
    },
    additionalProperties: false,
  },
  PolicyEvaluationOutput: {
    type: 'object',
    properties: {
      address: { type: 'string' },
      amount: { type: 'number' },
    },
    required: ['address', 'amount'],
  },
  PolicyEvaluationRequest: {
    type: 'object',
    properties: {
      recipient: { type: 'string' },
      amount: {
        oneOf: [
          { type: 'integer', minimum: 0 },
          { type: 'string', pattern: '^\\d+$' },
        ],
      },
      outputs: {
        type: 'array',
        items: { $ref: '#/components/schemas/PolicyEvaluationOutput' },
      },
    },
    required: ['recipient', 'amount'],
    additionalProperties: false,
  },
  PolicyEvaluationResponse: {
    type: 'object',
    properties: {
      allowed: { type: 'boolean' },
      triggered: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            policyId: { type: 'string' },
            policyName: { type: 'string' },
            type: { type: 'string', enum: [...VALID_POLICY_TYPES] },
            action: { type: 'string', enum: ['approval_required', 'blocked', 'monitored'] },
            reason: { type: 'string' },
          },
          required: ['policyId', 'policyName', 'type', 'action', 'reason'],
        },
      },
      limits: { type: 'object', additionalProperties: true },
    },
    required: ['allowed', 'triggered'],
  },
  PolicyEventsResponse: {
    type: 'object',
    properties: {
      events: {
        type: 'array',
        items: { type: 'object', additionalProperties: true },
      },
      total: { type: 'integer', minimum: 0 },
    },
    required: ['events', 'total'],
  },
  PolicyAddress: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      policyId: { type: 'string' },
      address: { type: 'string' },
      label: { type: 'string', nullable: true },
      listType: { type: 'string', enum: ['allow', 'deny'] },
      addedBy: { type: 'string' },
      createdAt: { type: 'string', format: 'date-time' },
    },
    required: ['id', 'policyId', 'address', 'listType'],
  },
  PolicyAddressListResponse: {
    type: 'object',
    properties: {
      addresses: {
        type: 'array',
        items: { $ref: '#/components/schemas/PolicyAddress' },
      },
    },
    required: ['addresses'],
  },
  PolicyAddressResponse: {
    type: 'object',
    properties: {
      address: { $ref: '#/components/schemas/PolicyAddress' },
    },
    required: ['address'],
  },
  CreatePolicyAddressRequest: {
    type: 'object',
    properties: {
      address: { type: 'string', maxLength: 100 },
      label: { type: 'string' },
      listType: { type: 'string', enum: ['allow', 'deny'] },
    },
    required: ['address', 'listType'],
    additionalProperties: false,
  },
  WalletPolicyDeleteResponse: {
    type: 'object',
    properties: {
      success: { type: 'boolean' },
    },
    required: ['success'],
  },
  WalletApprovalsResponse: {
    type: 'object',
    properties: {
      approvals: {
        type: 'array',
        items: { type: 'object', additionalProperties: true },
      },
    },
    required: ['approvals'],
  },
  PendingApproval: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      draftTransactionId: { type: 'string' },
      walletId: { type: 'string' },
      status: { type: 'string' },
      requiredApprovals: { type: 'integer', minimum: 0 },
      currentApprovals: { type: 'integer', minimum: 0 },
      totalVotes: { type: 'integer', minimum: 0 },
      recipient: { type: 'string', nullable: true },
      amount: { type: 'string', description: 'Satoshis serialized as a string' },
      expiresAt: { type: 'string', format: 'date-time', nullable: true },
      createdAt: { type: 'string', format: 'date-time' },
    },
    required: [
      'id',
      'draftTransactionId',
      'walletId',
      'status',
      'requiredApprovals',
      'currentApprovals',
      'totalVotes',
      'amount',
      'createdAt',
    ],
  },
  PendingApprovalsResponse: {
    type: 'object',
    properties: {
      approvals: {
        type: 'array',
        items: { $ref: '#/components/schemas/PendingApproval' },
      },
      total: { type: 'integer', minimum: 0 },
    },
    required: ['approvals', 'total'],
  },
  ApprovalVoteRequest: {
    type: 'object',
    properties: {
      decision: { type: 'string', enum: [...VALID_VOTE_DECISIONS] },
      reason: { type: 'string' },
    },
    required: ['decision'],
    additionalProperties: false,
  },
  ApprovalVoteResponse: {
    type: 'object',
    properties: {
      vote: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          decision: { type: 'string', enum: [...VALID_VOTE_DECISIONS] },
          reason: { type: 'string', nullable: true },
          createdAt: { type: 'string', format: 'date-time' },
        },
        required: ['id', 'decision', 'createdAt'],
      },
      request: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          status: { type: 'string' },
          requiredApprovals: { type: 'integer', minimum: 0 },
          currentApprovals: { type: 'integer', minimum: 0 },
          totalVotes: { type: 'integer', minimum: 0 },
        },
        required: ['id', 'status', 'requiredApprovals', 'currentApprovals', 'totalVotes'],
      },
    },
    required: ['vote', 'request'],
  },
  OwnerOverrideRequest: {
    type: 'object',
    properties: {
      reason: { type: 'string', minLength: 1 },
    },
    required: ['reason'],
    additionalProperties: false,
  },
} as const;
