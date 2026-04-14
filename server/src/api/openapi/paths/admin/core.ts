import {
  apiErrorResponse,
  bearerAuth,
  jsonDownloadResponse,
  jsonOneOfResponse,
  jsonRequestBody,
  jsonResponse,
  optionalJsonRequestBody,
} from './shared';

export const adminCorePaths = {
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
} as const;
