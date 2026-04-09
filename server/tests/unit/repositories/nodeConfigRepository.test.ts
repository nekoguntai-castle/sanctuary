/**
 * Node Config Repository Tests
 *
 * Tests for node configuration and Electrum server data access operations.
 */

import { vi, Mock } from 'vitest';

vi.mock('../../../src/models/prisma', () => ({
  __esModule: true,
  default: {
    nodeConfig: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    electrumServer: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  },
}));

vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import prisma from '../../../src/models/prisma';
import { nodeConfigRepository } from '../../../src/repositories/nodeConfigRepository';

describe('Node Config Repository', () => {
  const mockNodeConfig = {
    id: 'default',
    name: 'Default Node',
    isDefault: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockElectrumServer = {
    id: 'es-1',
    nodeConfigId: 'default',
    host: 'electrum.example.com',
    port: 50002,
    protocol: 'ssl',
    network: 'mainnet',
    enabled: true,
    priority: 0,
    isHealthy: true,
    lastHealthCheck: new Date(),
    lastHealthCheckError: null,
    healthCheckFails: 0,
    supportsVerbose: true,
    lastCapabilityCheck: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('findDefault', () => {
    it('should find the default node config', async () => {
      (prisma.nodeConfig.findFirst as Mock).mockResolvedValue(mockNodeConfig);

      const result = await nodeConfigRepository.findDefault();

      expect(result).toEqual(mockNodeConfig);
      expect(prisma.nodeConfig.findFirst).toHaveBeenCalledWith({
        where: { isDefault: true },
      });
    });

    it('should return null when no default config exists', async () => {
      (prisma.nodeConfig.findFirst as Mock).mockResolvedValue(null);

      const result = await nodeConfigRepository.findDefault();

      expect(result).toBeNull();
    });
  });

  describe('findDefaultWithServers', () => {
    it('should find default config with servers ordered by priority', async () => {
      const configWithServers = {
        ...mockNodeConfig,
        servers: [mockElectrumServer],
      };
      (prisma.nodeConfig.findFirst as Mock).mockResolvedValue(configWithServers);

      const result = await nodeConfigRepository.findDefaultWithServers();

      expect(result).toEqual(configWithServers);
      expect(prisma.nodeConfig.findFirst).toHaveBeenCalledWith({
        where: { isDefault: true },
        include: { servers: { orderBy: { priority: 'asc' } } },
      });
    });
  });

  describe('findOrCreateDefault', () => {
    it('should return existing default config', async () => {
      (prisma.nodeConfig.findFirst as Mock).mockResolvedValue(mockNodeConfig);

      const result = await nodeConfigRepository.findOrCreateDefault({
        name: 'New Config',
        isDefault: true,
      });

      expect(result).toEqual(mockNodeConfig);
      expect(prisma.nodeConfig.create).not.toHaveBeenCalled();
    });

    it('should create default config when none exists', async () => {
      (prisma.nodeConfig.findFirst as Mock).mockResolvedValue(null);
      (prisma.nodeConfig.create as Mock).mockResolvedValue(mockNodeConfig);

      const result = await nodeConfigRepository.findOrCreateDefault({
        name: 'New Config',
        isDefault: true,
      });

      expect(result).toEqual(mockNodeConfig);
      expect(prisma.nodeConfig.create).toHaveBeenCalledWith({
        data: {
          name: 'New Config',
          isDefault: true,
          id: 'default',
        },
      });
    });

    it('should use provided id when specified', async () => {
      (prisma.nodeConfig.findFirst as Mock).mockResolvedValue(null);
      (prisma.nodeConfig.create as Mock).mockResolvedValue(mockNodeConfig);

      await nodeConfigRepository.findOrCreateDefault({
        id: 'custom-id',
        name: 'New Config',
        isDefault: true,
      });

      expect(prisma.nodeConfig.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ id: 'custom-id' }),
      });
    });
  });

  describe('update', () => {
    it('should update node config by id', async () => {
      const updated = { ...mockNodeConfig, name: 'Updated' };
      (prisma.nodeConfig.update as Mock).mockResolvedValue(updated);

      const result = await nodeConfigRepository.update('default', {
        name: 'Updated',
      });

      expect(result).toEqual(updated);
      expect(prisma.nodeConfig.update).toHaveBeenCalledWith({
        where: { id: 'default' },
        data: { name: 'Updated' },
      });
    });
  });

  describe('electrumServer.findByConfig', () => {
    it('should find all servers for a config', async () => {
      (prisma.electrumServer.findMany as Mock).mockResolvedValue([mockElectrumServer]);

      const result = await nodeConfigRepository.electrumServer.findByConfig('default');

      expect(result).toEqual([mockElectrumServer]);
      expect(prisma.electrumServer.findMany).toHaveBeenCalledWith({
        where: { nodeConfigId: 'default' },
        orderBy: { priority: 'asc' },
      });
    });

    it('should filter by network when specified', async () => {
      (prisma.electrumServer.findMany as Mock).mockResolvedValue([mockElectrumServer]);

      await nodeConfigRepository.electrumServer.findByConfig('default', {
        network: 'mainnet',
      });

      expect(prisma.electrumServer.findMany).toHaveBeenCalledWith({
        where: { nodeConfigId: 'default', network: 'mainnet' },
        orderBy: { priority: 'asc' },
      });
    });

    it('should filter by enabled when specified', async () => {
      (prisma.electrumServer.findMany as Mock).mockResolvedValue([mockElectrumServer]);

      await nodeConfigRepository.electrumServer.findByConfig('default', {
        enabledOnly: true,
      });

      expect(prisma.electrumServer.findMany).toHaveBeenCalledWith({
        where: { nodeConfigId: 'default', enabled: true },
        orderBy: { priority: 'asc' },
      });
    });

    it('should apply both network and enabled filters', async () => {
      (prisma.electrumServer.findMany as Mock).mockResolvedValue([]);

      await nodeConfigRepository.electrumServer.findByConfig('default', {
        network: 'testnet',
        enabledOnly: true,
      });

      expect(prisma.electrumServer.findMany).toHaveBeenCalledWith({
        where: { nodeConfigId: 'default', network: 'testnet', enabled: true },
        orderBy: { priority: 'asc' },
      });
    });
  });

  describe('electrumServer.findById', () => {
    it('should find server by id', async () => {
      (prisma.electrumServer.findUnique as Mock).mockResolvedValue(mockElectrumServer);

      const result = await nodeConfigRepository.electrumServer.findById('es-1');

      expect(result).toEqual(mockElectrumServer);
      expect(prisma.electrumServer.findUnique).toHaveBeenCalledWith({
        where: { id: 'es-1' },
      });
    });

    it('should return null when server not found', async () => {
      (prisma.electrumServer.findUnique as Mock).mockResolvedValue(null);

      const result = await nodeConfigRepository.electrumServer.findById('missing');

      expect(result).toBeNull();
    });
  });

  describe('electrumServer.findByHostAndPort', () => {
    it('should find server by host, port, and network', async () => {
      (prisma.electrumServer.findFirst as Mock).mockResolvedValue(mockElectrumServer);

      const result = await nodeConfigRepository.electrumServer.findByHostAndPort(
        'Electrum.Example.com',
        50002,
        'mainnet'
      );

      expect(result).toEqual(mockElectrumServer);
      expect(prisma.electrumServer.findFirst).toHaveBeenCalledWith({
        where: {
          host: 'electrum.example.com',
          port: 50002,
          network: 'mainnet',
        },
      });
    });

    it('should exclude a specific id when provided', async () => {
      (prisma.electrumServer.findFirst as Mock).mockResolvedValue(null);

      await nodeConfigRepository.electrumServer.findByHostAndPort(
        'electrum.example.com',
        50002,
        'mainnet',
        'es-1'
      );

      expect(prisma.electrumServer.findFirst).toHaveBeenCalledWith({
        where: {
          host: 'electrum.example.com',
          port: 50002,
          network: 'mainnet',
          id: { not: 'es-1' },
        },
      });
    });
  });

  describe('electrumServer.create', () => {
    it('should create a new electrum server', async () => {
      (prisma.electrumServer.create as Mock).mockResolvedValue(mockElectrumServer);

      const result = await nodeConfigRepository.electrumServer.create({
        host: 'electrum.example.com',
        port: 50002,
        protocol: 'ssl',
        network: 'mainnet',
        nodeConfig: { connect: { id: 'default' } },
      });

      expect(result).toEqual(mockElectrumServer);
    });
  });

  describe('electrumServer.update', () => {
    it('should update an electrum server', async () => {
      const updated = { ...mockElectrumServer, port: 50003 };
      (prisma.electrumServer.update as Mock).mockResolvedValue(updated);

      const result = await nodeConfigRepository.electrumServer.update('es-1', {
        port: 50003,
      });

      expect(result).toEqual(updated);
      expect(prisma.electrumServer.update).toHaveBeenCalledWith({
        where: { id: 'es-1' },
        data: { port: 50003 },
      });
    });
  });

  describe('electrumServer.delete', () => {
    it('should delete an electrum server', async () => {
      (prisma.electrumServer.delete as Mock).mockResolvedValue(mockElectrumServer);

      const result = await nodeConfigRepository.electrumServer.delete('es-1');

      expect(result).toEqual(mockElectrumServer);
      expect(prisma.electrumServer.delete).toHaveBeenCalledWith({
        where: { id: 'es-1' },
      });
    });
  });

  describe('electrumServer.updateHealth', () => {
    it('should update health check data for healthy server', async () => {
      (prisma.electrumServer.update as Mock).mockResolvedValue(mockElectrumServer);

      await nodeConfigRepository.electrumServer.updateHealth('es-1', {
        isHealthy: true,
        lastHealthCheck: new Date('2025-01-15'),
      });

      expect(prisma.electrumServer.update).toHaveBeenCalledWith({
        where: { id: 'es-1' },
        data: expect.objectContaining({
          isHealthy: true,
          lastHealthCheck: new Date('2025-01-15'),
          lastHealthCheckError: null,
        }),
      });
    });

    it('should store error message for unhealthy server', async () => {
      (prisma.electrumServer.update as Mock).mockResolvedValue(mockElectrumServer);

      await nodeConfigRepository.electrumServer.updateHealth('es-1', {
        isHealthy: false,
        lastHealthCheckError: 'Connection refused',
      });

      expect(prisma.electrumServer.update).toHaveBeenCalledWith({
        where: { id: 'es-1' },
        data: expect.objectContaining({
          isHealthy: false,
          lastHealthCheckError: 'Connection refused',
        }),
      });
    });

    it('should include healthCheckFails when provided', async () => {
      (prisma.electrumServer.update as Mock).mockResolvedValue(mockElectrumServer);

      await nodeConfigRepository.electrumServer.updateHealth('es-1', {
        isHealthy: false,
        healthCheckFails: 3,
      });

      expect(prisma.electrumServer.update).toHaveBeenCalledWith({
        where: { id: 'es-1' },
        data: expect.objectContaining({
          healthCheckFails: 3,
        }),
      });
    });

    it('should include verbose capability data when provided', async () => {
      (prisma.electrumServer.update as Mock).mockResolvedValue(mockElectrumServer);

      const capabilityDate = new Date('2025-01-15');
      await nodeConfigRepository.electrumServer.updateHealth('es-1', {
        isHealthy: true,
        supportsVerbose: true,
        lastCapabilityCheck: capabilityDate,
      });

      expect(prisma.electrumServer.update).toHaveBeenCalledWith({
        where: { id: 'es-1' },
        data: expect.objectContaining({
          supportsVerbose: true,
          lastCapabilityCheck: capabilityDate,
        }),
      });
    });

    it('should use default date for lastCapabilityCheck when not provided', async () => {
      (prisma.electrumServer.update as Mock).mockResolvedValue(mockElectrumServer);

      await nodeConfigRepository.electrumServer.updateHealth('es-1', {
        isHealthy: true,
        supportsVerbose: false,
      });

      expect(prisma.electrumServer.update).toHaveBeenCalledWith({
        where: { id: 'es-1' },
        data: expect.objectContaining({
          supportsVerbose: false,
          lastCapabilityCheck: expect.any(Date),
        }),
      });
    });

    it('should use default date for lastHealthCheck when not provided', async () => {
      (prisma.electrumServer.update as Mock).mockResolvedValue(mockElectrumServer);

      await nodeConfigRepository.electrumServer.updateHealth('es-1', {
        isHealthy: true,
      });

      expect(prisma.electrumServer.update).toHaveBeenCalledWith({
        where: { id: 'es-1' },
        data: expect.objectContaining({
          lastHealthCheck: expect.any(Date),
        }),
      });
    });

    it('should set lastHealthCheckError to null for unhealthy server without explicit error', async () => {
      (prisma.electrumServer.update as Mock).mockResolvedValue(mockElectrumServer);

      await nodeConfigRepository.electrumServer.updateHealth('es-1', {
        isHealthy: false,
      });

      expect(prisma.electrumServer.update).toHaveBeenCalledWith({
        where: { id: 'es-1' },
        data: expect.objectContaining({
          lastHealthCheckError: null,
        }),
      });
    });

    it('should silently handle database errors', async () => {
      (prisma.electrumServer.update as Mock).mockRejectedValue(
        new Error('DB connection lost')
      );

      // Should not throw
      await nodeConfigRepository.electrumServer.updateHealth('es-1', {
        isHealthy: true,
      });
    });
  });

  describe('electrumServer.getMaxPriority', () => {
    it('should return highest priority value', async () => {
      (prisma.electrumServer.findFirst as Mock).mockResolvedValue({ priority: 5 });

      const result = await nodeConfigRepository.electrumServer.getMaxPriority(
        'default',
        'mainnet'
      );

      expect(result).toBe(5);
      expect(prisma.electrumServer.findFirst).toHaveBeenCalledWith({
        where: { nodeConfigId: 'default', network: 'mainnet' },
        orderBy: { priority: 'desc' },
        select: { priority: true },
      });
    });

    it('should return -1 when no servers exist', async () => {
      (prisma.electrumServer.findFirst as Mock).mockResolvedValue(null);

      const result = await nodeConfigRepository.electrumServer.getMaxPriority(
        'default',
        'mainnet'
      );

      expect(result).toBe(-1);
    });
  });

  describe('electrumServer.reorderPriorities', () => {
    it('should batch update priorities for multiple servers', async () => {
      (prisma.electrumServer.update as Mock).mockResolvedValue(mockElectrumServer);

      await nodeConfigRepository.electrumServer.reorderPriorities([
        { id: 'es-1', priority: 0 },
        { id: 'es-2', priority: 1 },
        { id: 'es-3', priority: 2 },
      ]);

      expect(prisma.electrumServer.update).toHaveBeenCalledTimes(3);
      expect(prisma.electrumServer.update).toHaveBeenCalledWith({
        where: { id: 'es-1' },
        data: { priority: 0 },
      });
      expect(prisma.electrumServer.update).toHaveBeenCalledWith({
        where: { id: 'es-2' },
        data: { priority: 1 },
      });
    });

    it('should handle empty updates array', async () => {
      await nodeConfigRepository.electrumServer.reorderPriorities([]);

      expect(prisma.electrumServer.update).not.toHaveBeenCalled();
    });
  });
});
