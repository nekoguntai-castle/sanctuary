import { vi } from 'vitest';
/**
 * Device API Routes Tests
 *
 * Tests for device management endpoints including:
 * - POST /devices (registration with accounts)
 * - GET /devices/:id/accounts
 * - POST /devices/:id/accounts
 * - DELETE /devices/:id/accounts/:accountId
 * - GET /devices/models (device catalog)
 * - GET /devices/models/:slug (specific model)
 * - GET /devices/manufacturers (manufacturer list)
 * - GET /devices/:id/share (sharing info)
 * - POST /devices/:id/share/user (share with user)
 * - DELETE /devices/:id/share/user/:targetUserId (remove user)
 * - POST /devices/:id/share/group (share with group)
 */

import { mockPrismaClient, resetPrismaMocks } from '../../mocks/prisma';

// Mock Prisma BEFORE other imports
vi.mock('../../../src/models/prisma', async () => {
  const { mockPrismaClient: prisma } = await import('../../mocks/prisma');
  return {
    __esModule: true,
    default: prisma,
  };
});

// Mock auth middleware to bypass JWT validation
vi.mock('../../../src/middleware/auth', () => ({
  authenticate: (req: any, res: any, next: any) => {
    req.user = { userId: 'test-user-id', username: 'testuser', isAdmin: false };
    next();
  },
}));

// Mock device access middleware
vi.mock('../../../src/middleware/deviceAccess', () => ({
  requireDeviceAccess: () => (req: any, res: any, next: any) => {
    req.deviceRole = req.headers['x-test-device-role'] || 'owner';
    req.deviceId = req.params.id;
    next();
  },
}));

// Mock device access service
vi.mock('../../../src/services/deviceAccess', () => ({
  getUserAccessibleDevices: vi.fn(),
  getDeviceShareInfo: vi.fn(),
  shareDeviceWithUser: vi.fn(),
  removeUserFromDevice: vi.fn(),
  shareDeviceWithGroup: vi.fn(),
  checkDeviceOwnerAccess: vi.fn(),
}));

// Mock logger
vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Mock requestContext (needed by errorHandler and auth middleware)
vi.mock('../../../src/utils/requestContext', () => ({
  requestContext: {
    getRequestId: () => 'test-request-id',
    setUser: vi.fn(),
    get: () => undefined,
    run: (_ctx: unknown, fn: () => unknown) => fn(),
    getUserId: () => undefined,
    getTraceId: () => undefined,
    setTraceId: vi.fn(),
    getDuration: () => 0,
    generateRequestId: () => 'test-request-id',
  },
}));

// Import after mocks
import request from 'supertest';
import express from 'express';
import { errorHandler } from '../../../src/errors/errorHandler';

// Create test app - must import router AFTER mocks are set up
const createTestApp = async () => {
  const app = express();
  app.use(express.json());

  // Import router dynamically after mocks
  const devicesModule = await import('../../../src/api/devices');
  app.use('/api/v1/devices', devicesModule.default);
  app.use(errorHandler);

  return app;
};

describe('Devices API', () => {
  let app: express.Application;

  beforeAll(async () => {
    app = await createTestApp();
  });

  beforeEach(() => {
    resetPrismaMocks();
    vi.clearAllMocks();
  });

  describe('POST /devices - Device Registration', () => {
    const validDevice = {
      type: 'trezor',
      label: 'My Trezor',
      fingerprint: 'abc12345',
      xpub: 'xpub6CUGRUonZSQ4TWtTMmzXdrXDtyPWV...',
      derivationPath: "m/84'/0'/0'",
    };

    it('should register device with single xpub (legacy mode)', async () => {
      mockPrismaClient.device.findUnique.mockResolvedValue(null); // No existing device
      mockPrismaClient.device.create.mockResolvedValue({
        id: 'device-1',
        ...validDevice,
        userId: 'test-user-id',
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      mockPrismaClient.device.findUnique.mockResolvedValueOnce(null).mockResolvedValue({
        id: 'device-1',
        ...validDevice,
        userId: 'test-user-id',
        accounts: [{
          id: 'account-1',
          deviceId: 'device-1',
          purpose: 'single_sig',
          scriptType: 'native_segwit',
          derivationPath: "m/84'/0'/0'",
          xpub: validDevice.xpub,
        }],
      });

      const response = await request(app)
        .post('/api/v1/devices')
        .send(validDevice);

      expect(response.status).toBe(201);
      expect(mockPrismaClient.device.create).toHaveBeenCalled();
      expect(mockPrismaClient.deviceUser.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          role: 'owner',
        }),
      });
      expect(mockPrismaClient.deviceAccount.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          purpose: 'single_sig',
          scriptType: 'native_segwit',
          derivationPath: "m/84'/0'/0'",
        }),
      });
    });

    it('should register device with multiple accounts', async () => {
      const deviceWithAccounts = {
        type: 'trezor',
        label: 'My Trezor',
        fingerprint: 'abc12345',
        accounts: [
          {
            purpose: 'single_sig',
            scriptType: 'native_segwit',
            derivationPath: "m/84'/0'/0'",
            xpub: 'xpub_single_sig...',
          },
          {
            purpose: 'multisig',
            scriptType: 'native_segwit',
            derivationPath: "m/48'/0'/0'/2'",
            xpub: 'xpub_multisig...',
          },
        ],
      };

      mockPrismaClient.device.findUnique.mockResolvedValue(null);
      mockPrismaClient.device.create.mockResolvedValue({
        id: 'device-1',
        type: deviceWithAccounts.type,
        label: deviceWithAccounts.label,
        fingerprint: deviceWithAccounts.fingerprint,
        xpub: 'xpub_single_sig...',
        derivationPath: "m/84'/0'/0'",
        userId: 'test-user-id',
      });

      const response = await request(app)
        .post('/api/v1/devices')
        .send(deviceWithAccounts);

      expect(response.status).toBe(201);
      expect(mockPrismaClient.deviceAccount.create).toHaveBeenCalledTimes(2);
    });

    it('should reject registration without xpub or accounts', async () => {
      const invalidDevice = {
        type: 'trezor',
        label: 'My Trezor',
        fingerprint: 'abc12345',
      };

      const response = await request(app)
        .post('/api/v1/devices')
        .send(invalidDevice);

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('xpub or accounts');
    });

    it('should reject registration when required top-level fields are missing', async () => {
      const response = await request(app)
        .post('/api/v1/devices')
        .send({ type: 'trezor', label: 'Missing Fingerprint', xpub: 'xpub...' });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('type, label, and fingerprint are required');
    });

    it('should reject registration when account entries are missing required fields', async () => {
      const response = await request(app)
        .post('/api/v1/devices')
        .send({
          type: 'trezor',
          label: 'Invalid Account',
          fingerprint: 'abc12345',
          accounts: [
            {
              purpose: 'single_sig',
              // Missing scriptType, derivationPath, xpub
            },
          ],
        });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('Each account must have purpose, scriptType, derivationPath, and xpub');
    });

    it('should reject registration with invalid purpose in accounts', async () => {
      const invalidDevice = {
        type: 'trezor',
        label: 'My Trezor',
        fingerprint: 'abc12345',
        accounts: [
          {
            purpose: 'invalid_purpose',
            scriptType: 'native_segwit',
            derivationPath: "m/84'/0'/0'",
            xpub: 'xpub...',
          },
        ],
      };

      const response = await request(app)
        .post('/api/v1/devices')
        .send(invalidDevice);

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('purpose');
    });

    it('should reject registration with invalid scriptType in accounts', async () => {
      const invalidDevice = {
        type: 'trezor',
        label: 'My Trezor',
        fingerprint: 'abc12345',
        accounts: [
          {
            purpose: 'single_sig',
            scriptType: 'invalid_script_type',
            derivationPath: "m/84'/0'/0'",
            xpub: 'xpub...',
          },
        ],
      };

      const response = await request(app)
        .post('/api/v1/devices')
        .send(invalidDevice);

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('scriptType');
    });

    it('should return conflict response with comparison data for duplicate fingerprint', async () => {
      const existingDevice = {
        id: 'existing-device',
        fingerprint: 'abc12345',
        label: 'Existing Trezor',
        type: 'trezor',
        userId: 'test-user-id',
        model: null,
        accounts: [
          {
            id: 'account-1',
            purpose: 'single_sig',
            scriptType: 'native_segwit',
            derivationPath: "m/84'/0'/0'",
            xpub: 'xpub_existing...',
          },
        ],
      };

      mockPrismaClient.device.findUnique.mockResolvedValue(existingDevice);

      const response = await request(app)
        .post('/api/v1/devices')
        .send(validDevice);

      expect(response.status).toBe(409);
      expect(response.body.error).toBe('Conflict');
      expect(response.body.existingDevice).toBeDefined();
      expect(response.body.existingDevice.id).toBe('existing-device');
      expect(response.body.existingDevice.fingerprint).toBe('abc12345');
      expect(response.body.comparison).toBeDefined();
      expect(response.body.comparison.newAccounts).toBeDefined();
      expect(response.body.comparison.matchingAccounts).toBeDefined();
      expect(response.body.comparison.conflictingAccounts).toBeDefined();
    });

    it('should merge new accounts into existing device when merge=true', async () => {
      const existingDevice = {
        id: 'existing-device',
        fingerprint: 'abc12345',
        label: 'Existing Trezor',
        type: 'trezor',
        userId: 'test-user-id',
        accounts: [
          {
            id: 'account-1',
            purpose: 'single_sig',
            scriptType: 'native_segwit',
            derivationPath: "m/84'/0'/0'",
            xpub: 'xpub_existing...',
          },
        ],
      };

      const deviceWithMerge = {
        type: 'trezor',
        label: 'My Trezor',
        fingerprint: 'abc12345',
        merge: true,
        accounts: [
          {
            purpose: 'multisig',
            scriptType: 'native_segwit',
            derivationPath: "m/48'/0'/0'/2'",
            xpub: 'xpub_new_multisig...',
          },
        ],
      };

      mockPrismaClient.device.findUnique.mockResolvedValue(existingDevice);
      mockPrismaClient.deviceAccount.create.mockResolvedValue({
        id: 'account-new',
        deviceId: 'existing-device',
        ...deviceWithMerge.accounts[0],
      });
      // Mock the updated device fetch after merge
      mockPrismaClient.device.findUnique.mockResolvedValueOnce(existingDevice).mockResolvedValue({
        ...existingDevice,
        accounts: [
          ...existingDevice.accounts,
          { id: 'account-new', ...deviceWithMerge.accounts[0] },
        ],
      });

      const response = await request(app)
        .post('/api/v1/devices')
        .send(deviceWithMerge);

      expect(response.status).toBe(200);
      expect(response.body.message).toContain('Added');
      expect(response.body.message).toContain('new account');
      expect(response.body.added).toBe(1);
      expect(response.body.device).toBeDefined();
      expect(mockPrismaClient.deviceAccount.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          deviceId: 'existing-device',
          purpose: 'multisig',
          scriptType: 'native_segwit',
        }),
      });
    });

    it('should return 200 with added=0 when merging with no new accounts', async () => {
      const existingDevice = {
        id: 'existing-device',
        fingerprint: 'abc12345',
        label: 'Existing Trezor',
        type: 'trezor',
        userId: 'test-user-id',
        accounts: [
          {
            id: 'account-1',
            purpose: 'single_sig',
            scriptType: 'native_segwit',
            derivationPath: "m/84'/0'/0'",
            xpub: 'xpub_same...',
          },
        ],
      };

      const deviceWithMerge = {
        type: 'trezor',
        label: 'My Trezor',
        fingerprint: 'abc12345',
        merge: true,
        accounts: [
          {
            purpose: 'single_sig',
            scriptType: 'native_segwit',
            derivationPath: "m/84'/0'/0'",
            xpub: 'xpub_same...', // Same xpub as existing
          },
        ],
      };

      mockPrismaClient.device.findUnique.mockResolvedValue(existingDevice);

      const response = await request(app)
        .post('/api/v1/devices')
        .send(deviceWithMerge);

      expect(response.status).toBe(200);
      expect(response.body.message).toContain('already has all');
      expect(response.body.added).toBe(0);
      expect(mockPrismaClient.deviceAccount.create).not.toHaveBeenCalled();
    });

    it('should reject merge when there are conflicting xpubs (security)', async () => {
      const existingDevice = {
        id: 'existing-device',
        fingerprint: 'abc12345',
        label: 'Existing Trezor',
        type: 'trezor',
        userId: 'test-user-id',
        accounts: [
          {
            id: 'account-1',
            purpose: 'single_sig',
            scriptType: 'native_segwit',
            derivationPath: "m/84'/0'/0'",
            xpub: 'xpub_original...',
          },
        ],
      };

      const deviceWithConflict = {
        type: 'trezor',
        label: 'My Trezor',
        fingerprint: 'abc12345',
        merge: true,
        accounts: [
          {
            purpose: 'single_sig',
            scriptType: 'native_segwit',
            derivationPath: "m/84'/0'/0'",
            xpub: 'xpub_different...', // DIFFERENT xpub at same path - security issue!
          },
        ],
      };

      mockPrismaClient.device.findUnique.mockResolvedValue(existingDevice);

      const response = await request(app)
        .post('/api/v1/devices')
        .send(deviceWithConflict);

      expect(response.status).toBe(409);
      expect(response.body.error).toBe('Conflict');
      expect(response.body.message).toContain('conflicting');
      // When there are conflicting accounts, the merge is rejected with conflict details
      expect(response.body.existingDevice).toBeDefined();
      // Conflicting accounts are returned at top level for merge mode
      expect(response.body.conflictingAccounts).toHaveLength(1);
      expect(response.body.conflictingAccounts[0].incoming.derivationPath).toBe("m/84'/0'/0'");
      expect(mockPrismaClient.deviceAccount.create).not.toHaveBeenCalled();
    });

    it('should detect duplicate device with different fingerprint case', async () => {
      // Device exists with lowercase fingerprint
      const existingDevice = {
        id: 'existing-device',
        fingerprint: 'abc12345', // lowercase in database
        label: 'Existing Device',
        type: 'trezor',
        userId: 'test-user-id',
        model: null,
        accounts: [
          {
            id: 'account-1',
            purpose: 'single_sig',
            scriptType: 'native_segwit',
            derivationPath: "m/84'/0'/0'",
            xpub: 'xpub_existing...',
          },
        ],
      };

      mockPrismaClient.device.findUnique.mockResolvedValue(existingDevice);

      // Incoming request has UPPERCASE fingerprint
      const deviceWithUpperCase = {
        type: 'trezor',
        label: 'My Trezor',
        fingerprint: 'ABC12345', // UPPERCASE in request
        xpub: 'xpub_new...',
        derivationPath: "m/84'/0'/0'",
      };

      const response = await request(app)
        .post('/api/v1/devices')
        .send(deviceWithUpperCase);

      // Should detect as duplicate (409) not create new device (201)
      expect(response.status).toBe(409);
      expect(response.body.existingDevice.fingerprint).toBe('abc12345');

      // Verify the findUnique was called with lowercase fingerprint
      expect(mockPrismaClient.device.findUnique).toHaveBeenCalledWith({
        where: { fingerprint: 'abc12345' }, // Should be normalized to lowercase
        include: expect.any(Object),
      });
    });

    it('should detect legacy script type from BIP-44 path in legacy mode', async () => {
      const legacyDevice = {
        type: 'ledger',
        label: 'Legacy Ledger',
        fingerprint: 'LEGACY123',
        xpub: 'xpub_legacy...',
        derivationPath: "m/44'/0'/0'",
      };

      mockPrismaClient.device.findUnique.mockResolvedValue(null);
      mockPrismaClient.device.create.mockResolvedValue({
        id: 'device-legacy',
        ...legacyDevice,
        userId: 'test-user-id',
      });

      await request(app)
        .post('/api/v1/devices')
        .send(legacyDevice);

      expect(mockPrismaClient.deviceAccount.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          purpose: 'single_sig',
          scriptType: 'legacy',
          derivationPath: "m/44'/0'/0'",
        }),
      });
    });

    it('should detect multisig purpose from BIP-48 path in legacy mode', async () => {
      const multisigDevice = {
        type: 'coldcard',
        label: 'My ColdCard',
        fingerprint: 'def67890',
        xpub: 'xpub_multisig...',
        derivationPath: "m/48'/0'/0'/2'",
      };

      mockPrismaClient.device.findUnique.mockResolvedValue(null);
      mockPrismaClient.device.create.mockResolvedValue({
        id: 'device-2',
        ...multisigDevice,
        userId: 'test-user-id',
      });

      await request(app)
        .post('/api/v1/devices')
        .send(multisigDevice);

      expect(mockPrismaClient.deviceAccount.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          purpose: 'multisig',
          scriptType: 'native_segwit',
          derivationPath: "m/48'/0'/0'/2'",
        }),
      });
    });

    it('should detect taproot script type from BIP-86 path in legacy mode', async () => {
      const taprootDevice = {
        type: 'ledger',
        label: 'Taproot Ledger',
        fingerprint: 'taproot123',
        xpub: 'xpub_taproot...',
        derivationPath: "m/86'/0'/0'",
      };

      mockPrismaClient.device.findUnique.mockResolvedValue(null);
      mockPrismaClient.device.create.mockResolvedValue({
        id: 'device-taproot',
        ...taprootDevice,
        userId: 'test-user-id',
      });

      await request(app)
        .post('/api/v1/devices')
        .send(taprootDevice);

      expect(mockPrismaClient.deviceAccount.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          scriptType: 'taproot',
          derivationPath: "m/86'/0'/0'",
        }),
      });
    });

    it('should detect nested segwit script type from BIP-49 path in legacy mode', async () => {
      const nestedDevice = {
        type: 'ledger',
        label: 'Nested Ledger',
        fingerprint: 'nested123',
        xpub: 'xpub_nested...',
        derivationPath: "m/49'/0'/0'",
      };

      mockPrismaClient.device.findUnique.mockResolvedValue(null);
      mockPrismaClient.device.create.mockResolvedValue({
        id: 'device-nested',
        ...nestedDevice,
        userId: 'test-user-id',
      });

      await request(app)
        .post('/api/v1/devices')
        .send(nestedDevice);

      expect(mockPrismaClient.deviceAccount.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          scriptType: 'nested_segwit',
          derivationPath: "m/49'/0'/0'",
        }),
      });
    });

    it('should assign modelId when modelSlug is provided for registration', async () => {
      const deviceWithModel = {
        type: 'trezor',
        label: 'Model Device',
        fingerprint: 'abcde123',
        xpub: 'xpub_model...',
        derivationPath: "m/84'/0'/0'",
        modelSlug: 'trezor-model-t',
      };

      mockPrismaClient.device.findUnique.mockResolvedValue(null);
      mockPrismaClient.hardwareDeviceModel.findUnique.mockResolvedValue({
        id: 'model-1',
        slug: 'trezor-model-t',
      });
      mockPrismaClient.device.create.mockResolvedValue({
        id: 'device-model',
        ...deviceWithModel,
        modelId: 'model-1',
        userId: 'test-user-id',
      });

      await request(app)
        .post('/api/v1/devices')
        .send(deviceWithModel);

      expect(mockPrismaClient.device.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          modelId: 'model-1',
        }),
        include: {
          model: true,
        },
      });
    });

    it('should continue registration without modelId when modelSlug is unknown', async () => {
      const deviceWithUnknownModel = {
        type: 'trezor',
        label: 'Unknown Model Device',
        fingerprint: 'unknownmodel1',
        xpub: 'xpub_unknown_model...',
        derivationPath: "m/84'/0'/0'",
        modelSlug: 'does-not-exist',
      };

      mockPrismaClient.device.findUnique.mockResolvedValue(null);
      mockPrismaClient.hardwareDeviceModel.findUnique.mockResolvedValue(null);
      mockPrismaClient.device.create.mockResolvedValue({
        id: 'device-unknown-model',
        ...deviceWithUnknownModel,
        userId: 'test-user-id',
      });

      const response = await request(app)
        .post('/api/v1/devices')
        .send(deviceWithUnknownModel);

      expect(response.status).toBe(201);
      expect(mockPrismaClient.device.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          modelId: undefined,
        }),
        include: { model: true },
      });
    });

    it('handles legacy xpub payload without derivationPath by creating device with no derived accounts', async () => {
      const xpubOnlyDevice = {
        type: 'trezor',
        label: 'Xpub Only',
        fingerprint: 'xpubonly12',
        xpub: 'xpub_only...',
      };

      mockPrismaClient.device.findUnique.mockResolvedValue(null);
      mockPrismaClient.device.create.mockResolvedValue({
        id: 'device-xpub-only',
        ...xpubOnlyDevice,
        userId: 'test-user-id',
      });

      const response = await request(app)
        .post('/api/v1/devices')
        .send(xpubOnlyDevice);

      expect(response.status).toBe(201);
      // With repository layer, device creation goes through createWithOwnerAndAccounts
      // which creates accounts in a transaction. Legacy xpub is stored on the device itself.
      expect(mockPrismaClient.device.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          fingerprint: 'xpubonly12',
          label: 'Xpub Only',
          type: 'trezor',
        }),
        include: { model: true },
      });
    });

    it('should return 500 when registration transaction fails', async () => {
      mockPrismaClient.device.findUnique.mockResolvedValue(null);
      mockPrismaClient.device.create.mockRejectedValue(new Error('insert failed'));

      const response = await request(app)
        .post('/api/v1/devices')
        .send(validDevice);

      expect(response.status).toBe(500);
      expect(response.body.code).toBe('INTERNAL_ERROR');
    });
  });

  describe('GET /devices/:id/accounts', () => {
    it('should return all accounts for a device', async () => {
      const mockAccounts = [
        {
          id: 'account-1',
          deviceId: 'device-1',
          purpose: 'single_sig',
          scriptType: 'native_segwit',
          derivationPath: "m/84'/0'/0'",
          xpub: 'xpub_single...',
        },
        {
          id: 'account-2',
          deviceId: 'device-1',
          purpose: 'multisig',
          scriptType: 'native_segwit',
          derivationPath: "m/48'/0'/0'/2'",
          xpub: 'xpub_multi...',
        },
      ];

      mockPrismaClient.deviceAccount.findMany.mockResolvedValue(mockAccounts);

      const response = await request(app)
        .get('/api/v1/devices/device-1/accounts');

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(2);
      expect(response.body[0].purpose).toBe('single_sig');
      expect(response.body[1].purpose).toBe('multisig');
    });

    it('should handle database errors while fetching accounts', async () => {
      mockPrismaClient.deviceAccount.findMany.mockRejectedValue(new Error('Database error'));

      const response = await request(app)
        .get('/api/v1/devices/device-1/accounts');

      expect(response.status).toBe(500);
      expect(response.body.code).toBe('INTERNAL_ERROR');
    });
  });

  describe('POST /devices/:id/accounts', () => {
    const newAccount = {
      purpose: 'multisig',
      scriptType: 'native_segwit',
      derivationPath: "m/48'/0'/0'/2'",
      xpub: 'xpub_multisig...',
    };

    it('should add a new account to existing device', async () => {
      mockPrismaClient.deviceAccount.findFirst.mockResolvedValue(null); // No existing account
      mockPrismaClient.deviceAccount.create.mockResolvedValue({
        id: 'account-new',
        deviceId: 'device-1',
        ...newAccount,
      });

      const response = await request(app)
        .post('/api/v1/devices/device-1/accounts')
        .send(newAccount);

      expect(response.status).toBe(201);
      expect(response.body.purpose).toBe('multisig');
      expect(mockPrismaClient.deviceAccount.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          deviceId: 'device-1',
          purpose: 'multisig',
          scriptType: 'native_segwit',
        }),
      });
    });

    it('should reject duplicate derivation path', async () => {
      mockPrismaClient.deviceAccount.findFirst.mockResolvedValue({
        id: 'existing-account',
        deviceId: 'device-1',
        derivationPath: "m/48'/0'/0'/2'",
      });

      const response = await request(app)
        .post('/api/v1/devices/device-1/accounts')
        .send(newAccount);

      expect(response.status).toBe(409);
      expect(response.body.message).toContain('already exists');
    });

    it('should reject missing required fields', async () => {
      const incompleteAccount = {
        purpose: 'multisig',
        // Missing scriptType, derivationPath, xpub
      };

      const response = await request(app)
        .post('/api/v1/devices/device-1/accounts')
        .send(incompleteAccount);

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('required');
    });

    it('should reject invalid purpose', async () => {
      const invalidAccount = {
        ...newAccount,
        purpose: 'invalid',
      };

      const response = await request(app)
        .post('/api/v1/devices/device-1/accounts')
        .send(invalidAccount);

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('purpose');
    });

    it('should reject invalid scriptType', async () => {
      const invalidAccount = {
        ...newAccount,
        scriptType: 'invalid_script_type',
      };

      const response = await request(app)
        .post('/api/v1/devices/device-1/accounts')
        .send(invalidAccount);

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('scriptType');
    });

    it('should handle database errors while adding an account', async () => {
      mockPrismaClient.deviceAccount.findFirst.mockResolvedValue(null);
      mockPrismaClient.deviceAccount.create.mockRejectedValue(new Error('Database error'));

      const response = await request(app)
        .post('/api/v1/devices/device-1/accounts')
        .send(newAccount);

      expect(response.status).toBe(500);
      expect(response.body.code).toBe('INTERNAL_ERROR');
    });
  });

  describe('DELETE /devices/:id/accounts/:accountId', () => {
    it('should delete account from device', async () => {
      mockPrismaClient.deviceAccount.findFirst.mockResolvedValue({
        id: 'account-1',
        deviceId: 'device-1',
        purpose: 'multisig',
        scriptType: 'native_segwit',
      });
      mockPrismaClient.deviceAccount.count.mockResolvedValue(2); // Has more than 1 account
      mockPrismaClient.deviceAccount.delete.mockResolvedValue({});

      const response = await request(app)
        .delete('/api/v1/devices/device-1/accounts/account-1');

      expect(response.status).toBe(204);
      expect(mockPrismaClient.deviceAccount.delete).toHaveBeenCalledWith({
        where: { id: 'account-1' },
      });
    });

    it('should prevent deleting last account', async () => {
      mockPrismaClient.deviceAccount.findFirst.mockResolvedValue({
        id: 'account-1',
        deviceId: 'device-1',
      });
      mockPrismaClient.deviceAccount.count.mockResolvedValue(1); // Only 1 account

      const response = await request(app)
        .delete('/api/v1/devices/device-1/accounts/account-1');

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('last account');
    });

    it('should return 404 for non-existent account', async () => {
      mockPrismaClient.deviceAccount.findFirst.mockResolvedValue(null);

      const response = await request(app)
        .delete('/api/v1/devices/device-1/accounts/non-existent');

      expect(response.status).toBe(404);
    });

    it('should handle database errors while deleting an account', async () => {
      mockPrismaClient.deviceAccount.findFirst.mockResolvedValue({
        id: 'account-1',
        deviceId: 'device-1',
        purpose: 'multisig',
        scriptType: 'native_segwit',
      });
      mockPrismaClient.deviceAccount.count.mockResolvedValue(2);
      mockPrismaClient.deviceAccount.delete.mockRejectedValue(new Error('Database error'));

      const response = await request(app)
        .delete('/api/v1/devices/device-1/accounts/account-1');

      expect(response.status).toBe(500);
      expect(response.body.code).toBe('INTERNAL_ERROR');
    });
  });

  // ========================================
  // Device CRUD Routes
  // ========================================

  describe('GET /devices - List All Devices', () => {
    it('should return all accessible devices', async () => {
      const { getUserAccessibleDevices } = await import('../../../src/services/deviceAccess');
      const mockGetUserAccessibleDevices = vi.mocked(getUserAccessibleDevices);

      mockGetUserAccessibleDevices.mockResolvedValue([
        {
          id: 'device-1',
          type: 'trezor',
          label: 'My Trezor',
          fingerprint: 'abc12345',
          role: 'owner',
        },
        {
          id: 'device-2',
          type: 'coldcard',
          label: 'Shared Coldcard',
          fingerprint: 'def67890',
          role: 'viewer',
        },
      ] as any);

      const response = await request(app)
        .get('/api/v1/devices');

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(2);
      expect(mockGetUserAccessibleDevices).toHaveBeenCalledWith('test-user-id');
    });

    it('should handle service errors gracefully', async () => {
      const { getUserAccessibleDevices } = await import('../../../src/services/deviceAccess');
      const mockGetUserAccessibleDevices = vi.mocked(getUserAccessibleDevices);

      mockGetUserAccessibleDevices.mockRejectedValue(new Error('Service error'));

      const response = await request(app)
        .get('/api/v1/devices');

      expect(response.status).toBe(500);
      expect(response.body.code).toBe('INTERNAL_ERROR');
    });
  });

  describe('GET /devices/:id - Get Specific Device', () => {
    it('should return device with access info', async () => {
      const mockDevice = {
        id: 'device-1',
        type: 'trezor',
        label: 'My Trezor',
        fingerprint: 'abc12345',
        model: { name: 'Model T' },
        accounts: [
          { id: 'account-1', purpose: 'single_sig', scriptType: 'native_segwit' },
        ],
        wallets: [],
        user: { username: 'testuser' },
      };

      mockPrismaClient.device.findUnique.mockResolvedValue(mockDevice);

      const response = await request(app)
        .get('/api/v1/devices/device-1');

      expect(response.status).toBe(200);
      expect(response.body.id).toBe('device-1');
      expect(response.body.isOwner).toBe(true);
      expect(response.body.userRole).toBe('owner');
    });

    it('should include sharedBy for non-owner access', async () => {
      mockPrismaClient.device.findUnique.mockResolvedValue({
        id: 'device-1',
        type: 'trezor',
        label: 'Shared Device',
        fingerprint: 'abc12345',
        model: { name: 'Model T' },
        accounts: [],
        wallets: [],
        user: { username: 'owneruser' },
      });

      const response = await request(app)
        .get('/api/v1/devices/device-1')
        .set('X-Test-Device-Role', 'viewer');

      expect(response.status).toBe(200);
      expect(response.body.isOwner).toBe(false);
      expect(response.body.userRole).toBe('viewer');
      expect(response.body.sharedBy).toBe('owneruser');
    });

    it('should return 404 when device not found', async () => {
      mockPrismaClient.device.findUnique.mockResolvedValue(null);

      const response = await request(app)
        .get('/api/v1/devices/non-existent');

      expect(response.status).toBe(404);
      expect(response.body.code).toBe('NOT_FOUND');
    });

    it('should handle database errors gracefully', async () => {
      mockPrismaClient.device.findUnique.mockRejectedValue(new Error('Database error'));

      const response = await request(app)
        .get('/api/v1/devices/device-1');

      expect(response.status).toBe(500);
      expect(response.body.code).toBe('INTERNAL_ERROR');
    });
  });

  describe('PATCH /devices/:id - Update Device', () => {
    it('should update device label', async () => {
      mockPrismaClient.device.update.mockResolvedValue({
        id: 'device-1',
        type: 'trezor',
        label: 'Updated Label',
        fingerprint: 'abc12345',
      });

      const response = await request(app)
        .patch('/api/v1/devices/device-1')
        .send({ label: 'Updated Label' });

      expect(response.status).toBe(200);
      expect(mockPrismaClient.device.update).toHaveBeenCalledWith({
        where: { id: 'device-1' },
        data: { label: 'Updated Label' },
        include: { model: true },
      });
    });

    it('should update device derivationPath and type when provided', async () => {
      mockPrismaClient.device.update.mockResolvedValue({
        id: 'device-1',
        type: 'ledger',
        label: 'My Trezor',
        derivationPath: "m/84'/0'/1'",
      });

      const response = await request(app)
        .patch('/api/v1/devices/device-1')
        .send({ derivationPath: "m/84'/0'/1'", type: 'ledger' });

      expect(response.status).toBe(200);
      expect(mockPrismaClient.device.update).toHaveBeenCalledWith({
        where: { id: 'device-1' },
        data: {
          derivationPath: "m/84'/0'/1'",
          type: 'ledger',
        },
        include: { model: true },
      });
    });

    it('should update device with model slug', async () => {
      mockPrismaClient.hardwareDeviceModel.findUnique.mockResolvedValue({
        id: 'model-1',
        slug: 'trezor-model-t',
        name: 'Model T',
      });
      mockPrismaClient.device.update.mockResolvedValue({
        id: 'device-1',
        type: 'trezor-model-t',
        label: 'My Trezor',
        modelId: 'model-1',
      });

      const response = await request(app)
        .patch('/api/v1/devices/device-1')
        .send({ modelSlug: 'trezor-model-t' });

      expect(response.status).toBe(200);
      expect(mockPrismaClient.device.update).toHaveBeenCalledWith({
        where: { id: 'device-1' },
        data: expect.objectContaining({
          modelId: 'model-1',
          type: 'trezor-model-t',
        }),
        include: { model: true },
      });
    });

    it('should return 400 for invalid model slug', async () => {
      mockPrismaClient.hardwareDeviceModel.findUnique.mockResolvedValue(null);

      const response = await request(app)
        .patch('/api/v1/devices/device-1')
        .send({ modelSlug: 'non-existent-model' });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('Invalid device model');
    });

    it('should handle database errors gracefully', async () => {
      mockPrismaClient.device.update.mockRejectedValue(new Error('Database error'));

      const response = await request(app)
        .patch('/api/v1/devices/device-1')
        .send({ label: 'Updated' });

      expect(response.status).toBe(500);
      expect(response.body.code).toBe('INTERNAL_ERROR');
    });
  });

  describe('DELETE /devices/:id - Delete Device', () => {
    it('should delete device not in use', async () => {
      mockPrismaClient.device.findUnique.mockResolvedValue({
        id: 'device-1',
        wallets: [],
      });
      mockPrismaClient.device.delete.mockResolvedValue({});

      const response = await request(app)
        .delete('/api/v1/devices/device-1');

      expect(response.status).toBe(204);
      expect(mockPrismaClient.device.delete).toHaveBeenCalledWith({
        where: { id: 'device-1' },
      });
    });

    it('should return 404 when device not found', async () => {
      mockPrismaClient.device.findUnique.mockResolvedValue(null);

      const response = await request(app)
        .delete('/api/v1/devices/non-existent');

      expect(response.status).toBe(404);
      expect(response.body.code).toBe('NOT_FOUND');
    });

    it('should return 409 when device is in use by wallet', async () => {
      mockPrismaClient.device.findUnique.mockResolvedValue({
        id: 'device-1',
        wallets: [
          { wallet: { id: 'wallet-1', name: 'My Wallet' } },
        ],
      });

      const response = await request(app)
        .delete('/api/v1/devices/device-1');

      expect(response.status).toBe(409);
      expect(response.body.code).toBe('CONFLICT');
      expect(response.body.message).toContain('in use by wallet');
    });

    it('should handle database errors gracefully', async () => {
      mockPrismaClient.device.findUnique.mockResolvedValue({
        id: 'device-1',
        wallets: [],
      });
      mockPrismaClient.device.delete.mockRejectedValue(new Error('Database error'));

      const response = await request(app)
        .delete('/api/v1/devices/device-1');

      expect(response.status).toBe(500);
      expect(response.body.code).toBe('INTERNAL_ERROR');
    });
  });

  // ========================================
  // Device Models Routes (Public Endpoints)
  // ========================================

  describe('GET /devices/models - Device Catalog', () => {
    const mockModels = [
      {
        id: 'model-1',
        slug: 'trezor-model-t',
        name: 'Model T',
        manufacturer: 'Trezor',
        airGapped: false,
        connectivity: ['USB'],
        discontinued: false,
      },
      {
        id: 'model-2',
        slug: 'coldcard-mk4',
        name: 'Coldcard MK4',
        manufacturer: 'Coinkite',
        airGapped: true,
        connectivity: ['MicroSD', 'NFC'],
        discontinued: false,
      },
      {
        id: 'model-3',
        slug: 'ledger-nano-x',
        name: 'Nano X',
        manufacturer: 'Ledger',
        airGapped: false,
        connectivity: ['USB', 'Bluetooth'],
        discontinued: false,
      },
    ];

    it('should return all non-discontinued models', async () => {
      mockPrismaClient.hardwareDeviceModel.findMany.mockResolvedValue(mockModels);

      const response = await request(app)
        .get('/api/v1/devices/models');

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(3);
      expect(mockPrismaClient.hardwareDeviceModel.findMany).toHaveBeenCalledWith({
        where: expect.objectContaining({
          discontinued: false,
        }),
        orderBy: [
          { manufacturer: 'asc' },
          { name: 'asc' },
        ],
      });
    });

    it('should filter by manufacturer', async () => {
      const trezorModels = [mockModels[0]];
      mockPrismaClient.hardwareDeviceModel.findMany.mockResolvedValue(trezorModels);

      const response = await request(app)
        .get('/api/v1/devices/models?manufacturer=Trezor');

      expect(response.status).toBe(200);
      expect(mockPrismaClient.hardwareDeviceModel.findMany).toHaveBeenCalledWith({
        where: expect.objectContaining({
          manufacturer: 'Trezor',
        }),
        orderBy: expect.any(Array),
      });
    });

    it('should filter by airGapped capability', async () => {
      const airGappedModels = [mockModels[1]];
      mockPrismaClient.hardwareDeviceModel.findMany.mockResolvedValue(airGappedModels);

      const response = await request(app)
        .get('/api/v1/devices/models?airGapped=true');

      expect(response.status).toBe(200);
      expect(mockPrismaClient.hardwareDeviceModel.findMany).toHaveBeenCalledWith({
        where: expect.objectContaining({
          airGapped: true,
        }),
        orderBy: expect.any(Array),
      });
    });

    it('should filter by connectivity type', async () => {
      const bluetoothModels = [mockModels[2]];
      mockPrismaClient.hardwareDeviceModel.findMany.mockResolvedValue(bluetoothModels);

      const response = await request(app)
        .get('/api/v1/devices/models?connectivity=Bluetooth');

      expect(response.status).toBe(200);
      expect(mockPrismaClient.hardwareDeviceModel.findMany).toHaveBeenCalledWith({
        where: expect.objectContaining({
          connectivity: { has: 'Bluetooth' },
        }),
        orderBy: expect.any(Array),
      });
    });

    it('should include discontinued models when showDiscontinued=true', async () => {
      const allModels = [...mockModels, { ...mockModels[0], id: 'model-4', discontinued: true }];
      mockPrismaClient.hardwareDeviceModel.findMany.mockResolvedValue(allModels);

      const response = await request(app)
        .get('/api/v1/devices/models?showDiscontinued=true');

      expect(response.status).toBe(200);
      // When showDiscontinued is provided, the discontinued filter should not be applied
      expect(mockPrismaClient.hardwareDeviceModel.findMany).toHaveBeenCalledWith({
        where: expect.not.objectContaining({
          discontinued: false,
        }),
        orderBy: expect.any(Array),
      });
    });

    it('should handle database errors gracefully', async () => {
      mockPrismaClient.hardwareDeviceModel.findMany.mockRejectedValue(new Error('Database error'));

      const response = await request(app)
        .get('/api/v1/devices/models');

      expect(response.status).toBe(500);
      expect(response.body.code).toBe('INTERNAL_ERROR');
    });
  });

  describe('GET /devices/models/:slug - Specific Model', () => {
    const mockModel = {
      id: 'model-1',
      slug: 'trezor-model-t',
      name: 'Model T',
      manufacturer: 'Trezor',
      airGapped: false,
      connectivity: ['USB'],
      discontinued: false,
      features: ['Touchscreen', 'Shamir Backup'],
    };

    it('should return model by slug', async () => {
      mockPrismaClient.hardwareDeviceModel.findUnique.mockResolvedValue(mockModel);

      const response = await request(app)
        .get('/api/v1/devices/models/trezor-model-t');

      expect(response.status).toBe(200);
      expect(response.body.slug).toBe('trezor-model-t');
      expect(response.body.manufacturer).toBe('Trezor');
      expect(mockPrismaClient.hardwareDeviceModel.findUnique).toHaveBeenCalledWith({
        where: { slug: 'trezor-model-t' },
      });
    });

    it('should return 404 for non-existent model', async () => {
      mockPrismaClient.hardwareDeviceModel.findUnique.mockResolvedValue(null);

      const response = await request(app)
        .get('/api/v1/devices/models/non-existent-model');

      expect(response.status).toBe(404);
      expect(response.body.code).toBe('NOT_FOUND');
      expect(response.body.message).toContain('not found');
    });

    it('should handle database errors gracefully', async () => {
      mockPrismaClient.hardwareDeviceModel.findUnique.mockRejectedValue(new Error('Database error'));

      const response = await request(app)
        .get('/api/v1/devices/models/trezor-model-t');

      expect(response.status).toBe(500);
      expect(response.body.code).toBe('INTERNAL_ERROR');
    });
  });

  describe('GET /devices/manufacturers - Manufacturer List', () => {
    it('should return list of manufacturers', async () => {
      mockPrismaClient.hardwareDeviceModel.findMany.mockResolvedValue([
        { manufacturer: 'Coinkite' },
        { manufacturer: 'Ledger' },
        { manufacturer: 'Trezor' },
      ]);

      const response = await request(app)
        .get('/api/v1/devices/manufacturers');

      expect(response.status).toBe(200);
      expect(response.body).toEqual(['Coinkite', 'Ledger', 'Trezor']);
      expect(mockPrismaClient.hardwareDeviceModel.findMany).toHaveBeenCalledWith({
        where: { discontinued: false },
        select: { manufacturer: true },
        distinct: ['manufacturer'],
        orderBy: { manufacturer: 'asc' },
      });
    });

    it('should return empty array when no manufacturers exist', async () => {
      mockPrismaClient.hardwareDeviceModel.findMany.mockResolvedValue([]);

      const response = await request(app)
        .get('/api/v1/devices/manufacturers');

      expect(response.status).toBe(200);
      expect(response.body).toEqual([]);
    });

    it('should handle database errors gracefully', async () => {
      mockPrismaClient.hardwareDeviceModel.findMany.mockRejectedValue(new Error('Database error'));

      const response = await request(app)
        .get('/api/v1/devices/manufacturers');

      expect(response.status).toBe(500);
      expect(response.body.code).toBe('INTERNAL_ERROR');
    });
  });

  // ========================================
  // Device Sharing Routes
  // ========================================

  describe('GET /devices/:id/share - Sharing Info', () => {
    it('should return device sharing info', async () => {
      const { getDeviceShareInfo } = await import('../../../src/services/deviceAccess');
      const mockGetDeviceShareInfo = vi.mocked(getDeviceShareInfo);

      mockGetDeviceShareInfo.mockResolvedValue({
        deviceId: 'device-1',
        owner: { id: 'test-user-id', username: 'testuser' },
        sharedUsers: [
          { id: 'user-2', username: 'otheruser', role: 'viewer' },
        ],
        group: null,
      });

      const response = await request(app)
        .get('/api/v1/devices/device-1/share');

      expect(response.status).toBe(200);
      expect(response.body.deviceId).toBe('device-1');
      expect(response.body.owner.username).toBe('testuser');
      expect(response.body.sharedUsers).toHaveLength(1);
      expect(mockGetDeviceShareInfo).toHaveBeenCalledWith('device-1');
    });

    it('should include group info when device is shared with group', async () => {
      const { getDeviceShareInfo } = await import('../../../src/services/deviceAccess');
      const mockGetDeviceShareInfo = vi.mocked(getDeviceShareInfo);

      mockGetDeviceShareInfo.mockResolvedValue({
        deviceId: 'device-1',
        owner: { id: 'test-user-id', username: 'testuser' },
        sharedUsers: [],
        group: { id: 'group-1', name: 'Family Group' },
      });

      const response = await request(app)
        .get('/api/v1/devices/device-1/share');

      expect(response.status).toBe(200);
      expect(response.body.group).toBeDefined();
      expect(response.body.group.name).toBe('Family Group');
    });

    it('should handle service errors gracefully', async () => {
      const { getDeviceShareInfo } = await import('../../../src/services/deviceAccess');
      const mockGetDeviceShareInfo = vi.mocked(getDeviceShareInfo);

      mockGetDeviceShareInfo.mockRejectedValue(new Error('Service error'));

      const response = await request(app)
        .get('/api/v1/devices/device-1/share');

      expect(response.status).toBe(500);
      expect(response.body.code).toBe('INTERNAL_ERROR');
    });
  });

  describe('POST /devices/:id/share/user - Share with User', () => {
    it('should share device with another user', async () => {
      const { shareDeviceWithUser } = await import('../../../src/services/deviceAccess');
      const mockShareDeviceWithUser = vi.mocked(shareDeviceWithUser);

      mockShareDeviceWithUser.mockResolvedValue({
        success: true,
        message: 'Device shared successfully',
      });

      const response = await request(app)
        .post('/api/v1/devices/device-1/share/user')
        .send({ targetUserId: 'user-2' });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(mockShareDeviceWithUser).toHaveBeenCalledWith('device-1', 'user-2', 'test-user-id');
    });

    it('should reject when targetUserId is missing', async () => {
      const response = await request(app)
        .post('/api/v1/devices/device-1/share/user')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('INVALID_INPUT');
      expect(response.body.message).toContain('targetUserId');
    });

    it('should return 400 when service returns failure', async () => {
      const { shareDeviceWithUser } = await import('../../../src/services/deviceAccess');
      const mockShareDeviceWithUser = vi.mocked(shareDeviceWithUser);

      mockShareDeviceWithUser.mockResolvedValue({
        success: false,
        message: 'User not found',
      });

      const response = await request(app)
        .post('/api/v1/devices/device-1/share/user')
        .send({ targetUserId: 'non-existent-user' });

      expect(response.status).toBe(400);
      expect(response.body.message).toBe('User not found');
    });

    it('should handle service errors gracefully', async () => {
      const { shareDeviceWithUser } = await import('../../../src/services/deviceAccess');
      const mockShareDeviceWithUser = vi.mocked(shareDeviceWithUser);

      mockShareDeviceWithUser.mockRejectedValue(new Error('Service error'));

      const response = await request(app)
        .post('/api/v1/devices/device-1/share/user')
        .send({ targetUserId: 'user-2' });

      expect(response.status).toBe(500);
      expect(response.body.code).toBe('INTERNAL_ERROR');
    });
  });

  describe('DELETE /devices/:id/share/user/:targetUserId - Remove User Access', () => {
    it('should remove user access to device', async () => {
      const { removeUserFromDevice } = await import('../../../src/services/deviceAccess');
      const mockRemoveUserFromDevice = vi.mocked(removeUserFromDevice);

      mockRemoveUserFromDevice.mockResolvedValue({
        success: true,
        message: 'User access removed',
      });

      const response = await request(app)
        .delete('/api/v1/devices/device-1/share/user/user-2');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(mockRemoveUserFromDevice).toHaveBeenCalledWith('device-1', 'user-2', 'test-user-id');
    });

    it('should return 400 when service returns failure', async () => {
      const { removeUserFromDevice } = await import('../../../src/services/deviceAccess');
      const mockRemoveUserFromDevice = vi.mocked(removeUserFromDevice);

      mockRemoveUserFromDevice.mockResolvedValue({
        success: false,
        message: 'Cannot remove owner',
      });

      const response = await request(app)
        .delete('/api/v1/devices/device-1/share/user/owner-user');

      expect(response.status).toBe(400);
      expect(response.body.message).toBe('Cannot remove owner');
    });

    it('should handle service errors gracefully', async () => {
      const { removeUserFromDevice } = await import('../../../src/services/deviceAccess');
      const mockRemoveUserFromDevice = vi.mocked(removeUserFromDevice);

      mockRemoveUserFromDevice.mockRejectedValue(new Error('Service error'));

      const response = await request(app)
        .delete('/api/v1/devices/device-1/share/user/user-2');

      expect(response.status).toBe(500);
      expect(response.body.code).toBe('INTERNAL_ERROR');
    });
  });

  describe('POST /devices/:id/share/group - Share with Group', () => {
    it('should share device with a group', async () => {
      const { shareDeviceWithGroup } = await import('../../../src/services/deviceAccess');
      const mockShareDeviceWithGroup = vi.mocked(shareDeviceWithGroup);

      mockShareDeviceWithGroup.mockResolvedValue({
        success: true,
        message: 'Device shared with group',
      });

      const response = await request(app)
        .post('/api/v1/devices/device-1/share/group')
        .send({ groupId: 'group-1' });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(mockShareDeviceWithGroup).toHaveBeenCalledWith('device-1', 'group-1', 'test-user-id');
    });

    it('should remove group access when groupId is null', async () => {
      const { shareDeviceWithGroup } = await import('../../../src/services/deviceAccess');
      const mockShareDeviceWithGroup = vi.mocked(shareDeviceWithGroup);

      mockShareDeviceWithGroup.mockResolvedValue({
        success: true,
        message: 'Group access removed',
      });

      const response = await request(app)
        .post('/api/v1/devices/device-1/share/group')
        .send({ groupId: null });

      expect(response.status).toBe(200);
      expect(mockShareDeviceWithGroup).toHaveBeenCalledWith('device-1', null, 'test-user-id');
    });

    it('should return 400 when service returns failure', async () => {
      const { shareDeviceWithGroup } = await import('../../../src/services/deviceAccess');
      const mockShareDeviceWithGroup = vi.mocked(shareDeviceWithGroup);

      mockShareDeviceWithGroup.mockResolvedValue({
        success: false,
        message: 'Group not found',
      });

      const response = await request(app)
        .post('/api/v1/devices/device-1/share/group')
        .send({ groupId: 'non-existent-group' });

      expect(response.status).toBe(400);
      expect(response.body.message).toBe('Group not found');
    });

    it('should handle service errors gracefully', async () => {
      const { shareDeviceWithGroup } = await import('../../../src/services/deviceAccess');
      const mockShareDeviceWithGroup = vi.mocked(shareDeviceWithGroup);

      mockShareDeviceWithGroup.mockRejectedValue(new Error('Service error'));

      const response = await request(app)
        .post('/api/v1/devices/device-1/share/group')
        .send({ groupId: 'group-1' });

      expect(response.status).toBe(500);
      expect(response.body.code).toBe('INTERNAL_ERROR');
    });
  });
});

describe('normalizeIncomingAccounts', () => {
  it('returns error when neither xpub nor accounts are provided', async () => {
    const { normalizeIncomingAccounts } = await import('../../../src/api/devices/accountConflicts');
    const result = normalizeIncomingAccounts(undefined, undefined, undefined);
    expect(result).toEqual({ error: 'Either xpub or accounts array is required' });
  });
});
