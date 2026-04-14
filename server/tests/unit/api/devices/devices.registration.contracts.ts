import { describe, expect, it } from 'vitest';
import request from 'supertest';

import { mockPrismaClient } from '../../../mocks/prisma';
import { app } from './devicesTestHarness';

export function registerDeviceRegistrationTests(): void {
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
}
