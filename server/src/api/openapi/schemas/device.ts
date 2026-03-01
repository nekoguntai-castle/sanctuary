/**
 * Device OpenAPI Schemas
 *
 * Schema definitions for hardware device management.
 */

export const deviceSchemas = {
  Device: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      label: { type: 'string' },
      fingerprint: { type: 'string' },
      xpub: { type: 'string', nullable: true },
      derivationPath: { type: 'string', nullable: true },
      createdAt: { type: 'string', format: 'date-time' },
      updatedAt: { type: 'string', format: 'date-time' },
      role: { type: 'string', enum: ['owner', 'viewer'] },
      walletCount: { type: 'integer' },
      model: { type: 'string', nullable: true },
      type: { type: 'string', nullable: true },
    },
    required: ['id', 'label', 'fingerprint', 'createdAt', 'role', 'walletCount'],
  },
  CreateDeviceRequest: {
    type: 'object',
    properties: {
      label: { type: 'string' },
      fingerprint: { type: 'string' },
      xpub: { type: 'string' },
      derivationPath: { type: 'string' },
      model: { type: 'string' },
      type: { type: 'string' },
    },
    required: ['label', 'fingerprint'],
  },
} as const;
