/**
 * Admin API Path Definitions
 *
 * OpenAPI path definitions for bounded administrative metadata and
 * configuration endpoints.
 */

import { FEATURE_FLAG_KEYS } from '../../../services/featureFlags/definitions';
import { AUDIT_DEFAULT_PAGE_SIZE, AUDIT_STATS_DAYS } from '../../../constants';

const bearerAuth = [{ bearerAuth: [] }] as const;
const AUDIT_LOG_LIMIT_MAX = 500;
const ELECTRUM_NETWORK_VALUES = ['mainnet', 'testnet', 'signet', 'regtest'] as const;

const apiErrorResponse = {
  description: 'Error response',
  content: {
    'application/json': {
      schema: { $ref: '#/components/schemas/ApiError' },
    },
  },
} as const;

const adminFeatureKeyParameter = {
  name: 'key',
  in: 'path',
  required: true,
  schema: { $ref: '#/components/schemas/AdminFeatureFlagKey' },
} as const;

const adminUserIdParameter = {
  name: 'userId',
  in: 'path',
  required: true,
  schema: { type: 'string' },
} as const;

const adminGroupIdParameter = {
  name: 'groupId',
  in: 'path',
  required: true,
  schema: { type: 'string' },
} as const;

const adminGroupMemberUserIdParameter = {
  name: 'userId',
  in: 'path',
  required: true,
  schema: { type: 'string' },
} as const;

const adminPolicyIdParameter = {
  name: 'policyId',
  in: 'path',
  required: true,
  schema: { type: 'string' },
} as const;

const adminElectrumNetworkPathParameter = {
  name: 'networkOrServerId',
  in: 'path',
  required: true,
  description: 'Electrum network name for GET requests.',
  schema: { type: 'string', enum: [...ELECTRUM_NETWORK_VALUES] },
} as const;

const adminElectrumServerIdOnSharedPathParameter = {
  name: 'networkOrServerId',
  in: 'path',
  required: true,
  description: 'Electrum server ID for update and delete requests.',
  schema: { type: 'string' },
} as const;

const adminElectrumServerIdParameter = {
  name: 'serverId',
  in: 'path',
  required: true,
  schema: { type: 'string' },
} as const;

const jsonRequestBody = (schemaRef: string) => ({
  required: true,
  content: {
    'application/json': {
      schema: { $ref: schemaRef },
    },
  },
});

const optionalJsonRequestBody = (schemaRef: string) => ({
  required: false,
  content: {
    'application/json': {
      schema: { $ref: schemaRef },
    },
  },
});

const jsonResponse = (description: string, schemaRef: string) => ({
  description,
  content: {
    'application/json': {
      schema: { $ref: schemaRef },
    },
  },
});

const jsonArrayResponse = (description: string, itemSchemaRef: string) => ({
  description,
  content: {
    'application/json': {
      schema: {
        type: 'array',
        items: { $ref: itemSchemaRef },
      },
    },
  },
});

const jsonOneOfResponse = (description: string, schemaRefs: string[]) => ({
  description,
  content: {
    'application/json': {
      schema: {
        oneOf: schemaRefs.map((schemaRef) => ({ $ref: schemaRef })),
      },
    },
  },
});

const jsonDownloadResponse = (description: string, schemaRef: string) => ({
  description,
  headers: {
    'Content-Disposition': {
      schema: { type: 'string' },
      description: 'Attachment filename for the generated JSON document.',
    },
  },
  content: {
    'application/json': {
      schema: { $ref: schemaRef },
    },
  },
});

const featureFlagResponse = jsonResponse('Feature flag', '#/components/schemas/AdminFeatureFlag');

export const adminPaths = {
  '/admin/version': {
    get: {
      tags: ['Admin'],
      summary: 'Get application version',
      description: 'Get the current application version and latest GitHub release metadata.',
      responses: {
        200: jsonResponse('Application version information', '#/components/schemas/AdminVersionResponse'),
        500: apiErrorResponse,
      },
    },
  },
  '/admin/settings': {
    get: {
      tags: ['Admin'],
      summary: 'Get system settings',
      description: 'Get administrative system settings. SMTP password values are never returned.',
      security: bearerAuth,
      responses: {
        200: jsonResponse('System settings', '#/components/schemas/AdminSettings'),
        401: apiErrorResponse,
        403: apiErrorResponse,
        500: apiErrorResponse,
      },
    },
    put: {
      tags: ['Admin'],
      summary: 'Update system settings',
      description: 'Update administrative system settings. SMTP password values are encrypted before storage and never returned.',
      security: bearerAuth,
      requestBody: jsonRequestBody('#/components/schemas/AdminSettingsUpdateRequest'),
      responses: {
        200: jsonResponse('Updated system settings', '#/components/schemas/AdminSettings'),
        400: apiErrorResponse,
        401: apiErrorResponse,
        403: apiErrorResponse,
        500: apiErrorResponse,
      },
    },
  },
  '/admin/encryption-keys': {
    post: {
      tags: ['Admin'],
      summary: 'Get encryption keys',
      description: 'Return backup restoration encryption keys after admin password re-authentication.',
      security: bearerAuth,
      requestBody: jsonRequestBody('#/components/schemas/AdminEncryptionKeysRequest'),
      responses: {
        200: jsonResponse('Encryption key material status', '#/components/schemas/AdminEncryptionKeysResponse'),
        400: apiErrorResponse,
        401: jsonResponse('Password verification failed', '#/components/schemas/AdminSimpleErrorResponse'),
        403: apiErrorResponse,
        500: apiErrorResponse,
      },
    },
  },
  '/admin/backup': {
    post: {
      tags: ['Admin'],
      summary: 'Create backup',
      description: 'Create and download a Sanctuary backup JSON document.',
      security: bearerAuth,
      requestBody: optionalJsonRequestBody('#/components/schemas/AdminCreateBackupRequest'),
      responses: {
        200: jsonDownloadResponse('Backup JSON document', '#/components/schemas/AdminSanctuaryBackup'),
        401: apiErrorResponse,
        403: apiErrorResponse,
        500: apiErrorResponse,
      },
    },
  },
  '/admin/backup/validate': {
    post: {
      tags: ['Admin'],
      summary: 'Validate backup',
      description: 'Validate a Sanctuary backup JSON document before restore.',
      security: bearerAuth,
      requestBody: jsonRequestBody('#/components/schemas/AdminBackupPayloadRequest'),
      responses: {
        200: jsonResponse('Backup validation result', '#/components/schemas/AdminBackupValidationResponse'),
        400: apiErrorResponse,
        401: apiErrorResponse,
        403: apiErrorResponse,
        500: apiErrorResponse,
      },
    },
  },
  '/admin/restore': {
    post: {
      tags: ['Admin'],
      summary: 'Restore backup',
      description: 'Restore the database from a Sanctuary backup. Requires the explicit CONFIRM_RESTORE confirmation code.',
      security: bearerAuth,
      requestBody: jsonRequestBody('#/components/schemas/AdminRestoreRequest'),
      responses: {
        200: jsonResponse('Restore completed', '#/components/schemas/AdminRestoreSuccessResponse'),
        400: {
          description: 'Invalid input or backup validation failure',
          content: {
            'application/json': {
              schema: {
                oneOf: [
                  { $ref: '#/components/schemas/ApiError' },
                  { $ref: '#/components/schemas/AdminRestoreInvalidBackupResponse' },
                ],
              },
            },
          },
        },
        401: apiErrorResponse,
        403: apiErrorResponse,
        500: {
          description: 'Restore failed or unexpected error',
          content: {
            'application/json': {
              schema: {
                oneOf: [
                  { $ref: '#/components/schemas/ApiError' },
                  { $ref: '#/components/schemas/AdminRestoreFailedResponse' },
                ],
              },
            },
          },
        },
      },
    },
  },
  '/admin/support-package': {
    post: {
      tags: ['Admin'],
      summary: 'Generate support package',
      description: 'Generate and download a diagnostic support package JSON document.',
      security: bearerAuth,
      responses: {
        200: jsonDownloadResponse('Support package JSON document', '#/components/schemas/AdminSupportPackage'),
        401: apiErrorResponse,
        403: apiErrorResponse,
        429: jsonResponse('Support package generation already in progress', '#/components/schemas/AdminSimpleErrorResponse'),
        500: apiErrorResponse,
      },
    },
  },
  '/admin/node-config': {
    get: {
      tags: ['Admin'],
      summary: 'Get node configuration',
      description: 'Get the default Electrum node configuration, including network pool settings, proxy settings, and configured server pool entries.',
      security: bearerAuth,
      responses: {
        200: jsonResponse('Node configuration', '#/components/schemas/AdminNodeConfig'),
        401: apiErrorResponse,
        403: apiErrorResponse,
        500: apiErrorResponse,
      },
    },
    put: {
      tags: ['Admin'],
      summary: 'Update node configuration',
      description: 'Update the default Electrum node configuration and reset the active node client so it reconnects on the next request.',
      security: bearerAuth,
      requestBody: jsonRequestBody('#/components/schemas/AdminNodeConfigUpdateRequest'),
      responses: {
        200: jsonResponse('Updated node configuration', '#/components/schemas/AdminNodeConfigUpdateResponse'),
        400: apiErrorResponse,
        401: apiErrorResponse,
        403: apiErrorResponse,
        500: apiErrorResponse,
      },
    },
  },
  '/admin/node-config/test': {
    post: {
      tags: ['Admin'],
      summary: 'Test node configuration',
      description: 'Test an Electrum node connection using the provided host, port, and SSL mode without saving the configuration.',
      security: bearerAuth,
      requestBody: jsonRequestBody('#/components/schemas/AdminNodeConfigTestRequest'),
      responses: {
        200: jsonResponse('Node connection test succeeded', '#/components/schemas/AdminNodeConfigTestSuccessResponse'),
        400: apiErrorResponse,
        401: apiErrorResponse,
        403: apiErrorResponse,
        500: jsonOneOfResponse('Node connection test failed or unexpected error', [
          '#/components/schemas/AdminNodeConfigTestFailedResponse',
          '#/components/schemas/ApiError',
        ]),
      },
    },
  },
  '/admin/proxy/test': {
    post: {
      tags: ['Admin'],
      summary: 'Test SOCKS5 proxy',
      description: 'Test SOCKS5/Tor proxy connectivity by verifying .onion reachability and attempting to resolve the Tor exit IP.',
      security: bearerAuth,
      requestBody: jsonRequestBody('#/components/schemas/AdminProxyTestRequest'),
      responses: {
        200: jsonResponse('Proxy test succeeded', '#/components/schemas/AdminProxyTestSuccessResponse'),
        400: apiErrorResponse,
        401: apiErrorResponse,
        403: apiErrorResponse,
        500: jsonOneOfResponse('Proxy test failed or unexpected error', [
          '#/components/schemas/AdminProxyTestFailedResponse',
          '#/components/schemas/ApiError',
        ]),
      },
    },
  },
  '/admin/electrum-servers': {
    get: {
      tags: ['Admin'],
      summary: 'List Electrum servers',
      description: 'List configured Electrum servers for the default node configuration, optionally filtered by network.',
      security: bearerAuth,
      parameters: [
        {
          name: 'network',
          in: 'query',
          required: false,
          schema: { type: 'string', enum: [...ELECTRUM_NETWORK_VALUES] },
        },
      ],
      responses: {
        200: jsonArrayResponse('Electrum servers', '#/components/schemas/AdminElectrumServer'),
        401: apiErrorResponse,
        403: apiErrorResponse,
        500: apiErrorResponse,
      },
    },
    post: {
      tags: ['Admin'],
      summary: 'Add Electrum server',
      description: 'Add an Electrum server to the default node configuration, creating the default config first when needed.',
      security: bearerAuth,
      requestBody: jsonRequestBody('#/components/schemas/AdminCreateElectrumServerRequest'),
      responses: {
        201: jsonResponse('Created Electrum server', '#/components/schemas/AdminElectrumServer'),
        400: apiErrorResponse,
        401: apiErrorResponse,
        403: apiErrorResponse,
        409: apiErrorResponse,
        500: apiErrorResponse,
      },
    },
  },
  '/admin/electrum-servers/test-connection': {
    post: {
      tags: ['Admin'],
      summary: 'Test Electrum connection',
      description: 'Test a provided Electrum host, port, and SSL mode without saving it as a configured server.',
      security: bearerAuth,
      requestBody: jsonRequestBody('#/components/schemas/AdminElectrumConnectionTestRequest'),
      responses: {
        200: jsonResponse('Electrum connection test result', '#/components/schemas/AdminElectrumConnectionTestResponse'),
        400: apiErrorResponse,
        401: apiErrorResponse,
        403: apiErrorResponse,
        500: apiErrorResponse,
      },
    },
  },
  '/admin/electrum-servers/reorder': {
    put: {
      tags: ['Admin'],
      summary: 'Reorder Electrum servers',
      description: 'Update Electrum server priorities to match the supplied server ID order and reload the Electrum pool.',
      security: bearerAuth,
      requestBody: jsonRequestBody('#/components/schemas/AdminReorderElectrumServersRequest'),
      responses: {
        200: jsonResponse('Electrum servers reordered', '#/components/schemas/AdminReorderElectrumServersResponse'),
        400: apiErrorResponse,
        401: apiErrorResponse,
        403: apiErrorResponse,
        500: apiErrorResponse,
      },
    },
  },
  '/admin/electrum-servers/{networkOrServerId}': {
    get: {
      tags: ['Admin'],
      summary: 'List Electrum servers by network',
      description: 'List configured Electrum servers for a specific network. Runtime routes this operation through the same path depth used by server ID operations.',
      security: bearerAuth,
      parameters: [adminElectrumNetworkPathParameter],
      responses: {
        200: jsonArrayResponse('Electrum servers for the network', '#/components/schemas/AdminElectrumServer'),
        400: apiErrorResponse,
        401: apiErrorResponse,
        403: apiErrorResponse,
        500: apiErrorResponse,
      },
    },
    put: {
      tags: ['Admin'],
      summary: 'Update Electrum server',
      description: 'Update an Electrum server and reload the Electrum pool.',
      security: bearerAuth,
      parameters: [adminElectrumServerIdOnSharedPathParameter],
      requestBody: jsonRequestBody('#/components/schemas/AdminUpdateElectrumServerRequest'),
      responses: {
        200: jsonResponse('Updated Electrum server', '#/components/schemas/AdminElectrumServer'),
        400: apiErrorResponse,
        401: apiErrorResponse,
        403: apiErrorResponse,
        404: apiErrorResponse,
        409: apiErrorResponse,
        500: apiErrorResponse,
      },
    },
    delete: {
      tags: ['Admin'],
      summary: 'Delete Electrum server',
      description: 'Delete an Electrum server and reload the Electrum pool.',
      security: bearerAuth,
      parameters: [adminElectrumServerIdOnSharedPathParameter],
      responses: {
        200: jsonResponse('Electrum server deleted', '#/components/schemas/AdminDeleteElectrumServerResponse'),
        401: apiErrorResponse,
        403: apiErrorResponse,
        404: apiErrorResponse,
        500: apiErrorResponse,
      },
    },
  },
  '/admin/electrum-servers/{serverId}/test': {
    post: {
      tags: ['Admin'],
      summary: 'Test configured Electrum server',
      description: 'Test a configured Electrum server and update its health and capability fields.',
      security: bearerAuth,
      parameters: [adminElectrumServerIdParameter],
      responses: {
        200: jsonResponse('Configured Electrum server test result', '#/components/schemas/AdminElectrumServerTestResponse'),
        401: apiErrorResponse,
        403: apiErrorResponse,
        404: apiErrorResponse,
        500: apiErrorResponse,
      },
    },
  },
  '/admin/users': {
    get: {
      tags: ['Admin'],
      summary: 'List users',
      description: 'List user account summaries for administrative management.',
      security: bearerAuth,
      responses: {
        200: {
          description: 'User account summaries',
          content: {
            'application/json': {
              schema: {
                type: 'array',
                items: { $ref: '#/components/schemas/AdminUser' },
              },
            },
          },
        },
        401: apiErrorResponse,
        403: apiErrorResponse,
        500: apiErrorResponse,
      },
    },
    post: {
      tags: ['Admin'],
      summary: 'Create user',
      description: 'Create a trusted user account with an auto-verified email address.',
      security: bearerAuth,
      requestBody: jsonRequestBody('#/components/schemas/AdminCreateUserRequest'),
      responses: {
        201: jsonResponse('Created user', '#/components/schemas/AdminUser'),
        400: apiErrorResponse,
        401: apiErrorResponse,
        403: apiErrorResponse,
        409: apiErrorResponse,
        500: apiErrorResponse,
      },
    },
  },
  '/admin/users/{userId}': {
    put: {
      tags: ['Admin'],
      summary: 'Update user',
      description: 'Update user account fields, admin status, email verification state, or password.',
      security: bearerAuth,
      parameters: [adminUserIdParameter],
      requestBody: jsonRequestBody('#/components/schemas/AdminUpdateUserRequest'),
      responses: {
        200: jsonResponse('Updated user', '#/components/schemas/AdminUser'),
        400: apiErrorResponse,
        401: apiErrorResponse,
        403: apiErrorResponse,
        404: apiErrorResponse,
        409: apiErrorResponse,
        500: apiErrorResponse,
      },
    },
    delete: {
      tags: ['Admin'],
      summary: 'Delete user',
      description: 'Delete a user account. The current admin cannot delete their own account.',
      security: bearerAuth,
      parameters: [adminUserIdParameter],
      responses: {
        200: jsonResponse('User deleted', '#/components/schemas/AdminDeleteUserResponse'),
        400: apiErrorResponse,
        401: apiErrorResponse,
        403: apiErrorResponse,
        404: apiErrorResponse,
        500: apiErrorResponse,
      },
    },
  },
  '/admin/groups': {
    get: {
      tags: ['Admin'],
      summary: 'List groups',
      description: 'List administrative groups with their members.',
      security: bearerAuth,
      responses: {
        200: {
          description: 'Groups',
          content: {
            'application/json': {
              schema: {
                type: 'array',
                items: { $ref: '#/components/schemas/AdminGroup' },
              },
            },
          },
        },
        401: apiErrorResponse,
        403: apiErrorResponse,
        500: apiErrorResponse,
      },
    },
    post: {
      tags: ['Admin'],
      summary: 'Create group',
      description: 'Create an administrative group and optionally add existing users as members.',
      security: bearerAuth,
      requestBody: jsonRequestBody('#/components/schemas/AdminCreateGroupRequest'),
      responses: {
        201: jsonResponse('Created group', '#/components/schemas/AdminGroup'),
        400: apiErrorResponse,
        401: apiErrorResponse,
        403: apiErrorResponse,
        500: apiErrorResponse,
      },
    },
  },
  '/admin/groups/{groupId}': {
    put: {
      tags: ['Admin'],
      summary: 'Update group',
      description: 'Update group fields and optionally replace the group member set.',
      security: bearerAuth,
      parameters: [adminGroupIdParameter],
      requestBody: jsonRequestBody('#/components/schemas/AdminUpdateGroupRequest'),
      responses: {
        200: jsonResponse('Updated group', '#/components/schemas/AdminGroup'),
        400: apiErrorResponse,
        401: apiErrorResponse,
        403: apiErrorResponse,
        404: apiErrorResponse,
        500: apiErrorResponse,
      },
    },
    delete: {
      tags: ['Admin'],
      summary: 'Delete group',
      description: 'Delete an administrative group and invalidate access caches for former members.',
      security: bearerAuth,
      parameters: [adminGroupIdParameter],
      responses: {
        200: jsonResponse('Group deleted', '#/components/schemas/AdminDeleteGroupResponse'),
        401: apiErrorResponse,
        403: apiErrorResponse,
        404: apiErrorResponse,
        500: apiErrorResponse,
      },
    },
  },
  '/admin/groups/{groupId}/members': {
    post: {
      tags: ['Admin'],
      summary: 'Add group member',
      description: 'Add an existing user to an administrative group.',
      security: bearerAuth,
      parameters: [adminGroupIdParameter],
      requestBody: jsonRequestBody('#/components/schemas/AdminAddGroupMemberRequest'),
      responses: {
        201: jsonResponse('Group member added', '#/components/schemas/AdminGroupMember'),
        400: apiErrorResponse,
        401: apiErrorResponse,
        403: apiErrorResponse,
        404: apiErrorResponse,
        409: apiErrorResponse,
        500: apiErrorResponse,
      },
    },
  },
  '/admin/groups/{groupId}/members/{userId}': {
    delete: {
      tags: ['Admin'],
      summary: 'Remove group member',
      description: 'Remove a user from an administrative group.',
      security: bearerAuth,
      parameters: [adminGroupIdParameter, adminGroupMemberUserIdParameter],
      responses: {
        200: jsonResponse('Group member removed', '#/components/schemas/AdminRemoveGroupMemberResponse'),
        401: apiErrorResponse,
        403: apiErrorResponse,
        404: apiErrorResponse,
        500: apiErrorResponse,
      },
    },
  },
  '/admin/policies': {
    get: {
      tags: ['Admin'],
      summary: 'List system policies',
      description: 'List system-wide vault policies for administrative management.',
      security: bearerAuth,
      responses: {
        200: jsonResponse('System policies', '#/components/schemas/VaultPolicyListResponse'),
        401: apiErrorResponse,
        403: apiErrorResponse,
        500: apiErrorResponse,
      },
    },
    post: {
      tags: ['Admin'],
      summary: 'Create system policy',
      description: 'Create a system-wide vault policy.',
      security: bearerAuth,
      requestBody: jsonRequestBody('#/components/schemas/CreateVaultPolicyRequest'),
      responses: {
        201: jsonResponse('Created system policy', '#/components/schemas/VaultPolicyResponse'),
        400: apiErrorResponse,
        401: apiErrorResponse,
        403: apiErrorResponse,
        500: apiErrorResponse,
      },
    },
  },
  '/admin/policies/{policyId}': {
    patch: {
      tags: ['Admin'],
      summary: 'Update system policy',
      description: 'Update a system-wide vault policy. Non-system policies are rejected.',
      security: bearerAuth,
      parameters: [adminPolicyIdParameter],
      requestBody: jsonRequestBody('#/components/schemas/UpdateVaultPolicyRequest'),
      responses: {
        200: jsonResponse('Updated system policy', '#/components/schemas/VaultPolicyResponse'),
        400: apiErrorResponse,
        401: apiErrorResponse,
        403: apiErrorResponse,
        404: apiErrorResponse,
        500: apiErrorResponse,
      },
    },
    delete: {
      tags: ['Admin'],
      summary: 'Delete system policy',
      description: 'Delete a system-wide vault policy. Non-system policies are rejected.',
      security: bearerAuth,
      parameters: [adminPolicyIdParameter],
      responses: {
        200: jsonResponse('System policy deleted', '#/components/schemas/AdminPolicyDeleteResponse'),
        401: apiErrorResponse,
        403: apiErrorResponse,
        404: apiErrorResponse,
        500: apiErrorResponse,
      },
    },
  },
  '/admin/features': {
    get: {
      tags: ['Admin'],
      summary: 'List feature flags',
      description: 'List runtime feature flag state from environment and database overrides.',
      security: bearerAuth,
      responses: {
        200: {
          description: 'Feature flags',
          content: {
            'application/json': {
              schema: {
                type: 'array',
                items: { $ref: '#/components/schemas/AdminFeatureFlag' },
              },
            },
          },
        },
        401: apiErrorResponse,
        403: apiErrorResponse,
        500: apiErrorResponse,
      },
    },
  },
  '/admin/audit-logs': {
    get: {
      tags: ['Admin'],
      summary: 'List audit logs',
      description: 'List administrative audit logs with filters and clamped pagination.',
      security: bearerAuth,
      parameters: [
        {
          name: 'userId',
          in: 'query',
          required: false,
          schema: { type: 'string' },
        },
        {
          name: 'username',
          in: 'query',
          required: false,
          schema: { type: 'string' },
        },
        {
          name: 'action',
          in: 'query',
          required: false,
          schema: { type: 'string' },
        },
        {
          name: 'category',
          in: 'query',
          required: false,
          schema: { type: 'string' },
        },
        {
          name: 'success',
          in: 'query',
          required: false,
          schema: { type: 'boolean' },
        },
        {
          name: 'startDate',
          in: 'query',
          required: false,
          schema: { type: 'string' },
        },
        {
          name: 'endDate',
          in: 'query',
          required: false,
          schema: { type: 'string' },
        },
        {
          name: 'limit',
          in: 'query',
          required: false,
          schema: {
            type: 'integer',
            minimum: 1,
            maximum: AUDIT_LOG_LIMIT_MAX,
            default: AUDIT_DEFAULT_PAGE_SIZE,
          },
        },
        {
          name: 'offset',
          in: 'query',
          required: false,
          schema: { type: 'integer', minimum: 0, default: 0 },
        },
      ],
      responses: {
        200: jsonResponse('Audit log entries', '#/components/schemas/AdminAuditLogsResponse'),
        401: apiErrorResponse,
        403: apiErrorResponse,
        500: apiErrorResponse,
      },
    },
  },
  '/admin/audit-logs/stats': {
    get: {
      tags: ['Admin'],
      summary: 'Get audit log statistics',
      description: 'Get aggregate audit log statistics for a recent day window.',
      security: bearerAuth,
      parameters: [
        {
          name: 'days',
          in: 'query',
          required: false,
          schema: { type: 'integer', minimum: 1, default: AUDIT_STATS_DAYS },
        },
      ],
      responses: {
        200: jsonResponse('Audit log statistics', '#/components/schemas/AdminAuditStatsResponse'),
        401: apiErrorResponse,
        403: apiErrorResponse,
        500: apiErrorResponse,
      },
    },
  },
  '/admin/features/audit-log': {
    get: {
      tags: ['Admin'],
      summary: 'Get feature flag audit log',
      description: 'Get paginated feature flag audit entries, optionally filtered by feature flag key.',
      security: bearerAuth,
      parameters: [
        {
          name: 'key',
          in: 'query',
          required: false,
          schema: { type: 'string', enum: [...FEATURE_FLAG_KEYS] },
        },
        {
          name: 'limit',
          in: 'query',
          required: false,
          schema: { type: 'integer', minimum: 1, maximum: 200, default: 50 },
        },
        {
          name: 'offset',
          in: 'query',
          required: false,
          schema: { type: 'integer', minimum: 0, default: 0 },
        },
      ],
      responses: {
        200: jsonResponse('Feature flag audit entries', '#/components/schemas/AdminFeatureFlagAuditResponse'),
        400: apiErrorResponse,
        401: apiErrorResponse,
        403: apiErrorResponse,
        500: apiErrorResponse,
      },
    },
  },
  '/admin/features/{key}': {
    get: {
      tags: ['Admin'],
      summary: 'Get feature flag',
      description: 'Get a single runtime feature flag by key.',
      security: bearerAuth,
      parameters: [adminFeatureKeyParameter],
      responses: {
        200: featureFlagResponse,
        400: apiErrorResponse,
        401: apiErrorResponse,
        403: apiErrorResponse,
        404: apiErrorResponse,
        500: apiErrorResponse,
      },
    },
    patch: {
      tags: ['Admin'],
      summary: 'Update feature flag',
      description: 'Set a database override for a runtime feature flag.',
      security: bearerAuth,
      parameters: [adminFeatureKeyParameter],
      requestBody: jsonRequestBody('#/components/schemas/AdminUpdateFeatureFlagRequest'),
      responses: {
        200: featureFlagResponse,
        400: apiErrorResponse,
        401: apiErrorResponse,
        403: apiErrorResponse,
        404: apiErrorResponse,
        500: apiErrorResponse,
      },
    },
  },
  '/admin/features/{key}/reset': {
    post: {
      tags: ['Admin'],
      summary: 'Reset feature flag',
      description: 'Remove a database override and reset a runtime feature flag to its environment default.',
      security: bearerAuth,
      parameters: [adminFeatureKeyParameter],
      responses: {
        200: featureFlagResponse,
        400: apiErrorResponse,
        401: apiErrorResponse,
        403: apiErrorResponse,
        404: apiErrorResponse,
        500: apiErrorResponse,
      },
    },
  },
} as const;
