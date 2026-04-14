import { describe, expect, it, vi } from 'vitest';
import request from 'supertest';

import { mockPrismaClient } from '../../../mocks/prisma';
import { app } from './devicesTestHarness';

export function registerDeviceCrudTests(): void {
  // ========================================
  // Device CRUD Routes
  // ========================================

  describe('GET /devices - List All Devices', () => {
    it('should return all accessible devices', async () => {
      const { getUserAccessibleDevices } = await import('../../../../src/services/deviceAccess');
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
      const { getUserAccessibleDevices } = await import('../../../../src/services/deviceAccess');
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
}
