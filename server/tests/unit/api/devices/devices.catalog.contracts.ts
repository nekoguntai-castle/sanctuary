import { describe, expect, it } from 'vitest';
import request from 'supertest';

import { mockPrismaClient } from '../../../mocks/prisma';
import { app } from './devicesTestHarness';

export function registerDeviceCatalogTests(): void {
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
}
