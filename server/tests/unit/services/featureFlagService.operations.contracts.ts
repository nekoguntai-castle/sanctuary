import { createHash } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import { mockPrisma, mockCache, mockConfig, mockEventBus } from './featureFlagServiceTestMocks';
import { featureFlagService } from '../../../src/services/featureFlagService';

export function registerFeatureFlagOperationContracts() {
  describe('isEnabled', () => {
    beforeEach(async () => {
      mockPrisma.featureFlag.findUnique.mockResolvedValue(null);
      mockPrisma.featureFlag.findMany.mockResolvedValue([]);
      await featureFlagService.initialize();
    });

    it('should return value from local cache if available', async () => {
      (featureFlagService as any).localCache.set('hardwareWalletSigning', true);

      const result = await featureFlagService.isEnabled('hardwareWalletSigning');

      expect(result).toBe(true);
      expect(mockCache.get).not.toHaveBeenCalled(); // Didn't need distributed cache
    });

    it('should check distributed cache if local cache misses', async () => {
      (featureFlagService as any).localCache.delete('hardwareWalletSigning');
      const flags = { hardwareWalletSigning: true };
      mockCache.get.mockResolvedValue({
        generation: '2',
        digest: createHash('sha256').update(JSON.stringify(flags)).digest('hex'),
        flags,
      });

      const result = await featureFlagService.isEnabled('hardwareWalletSigning');

      expect(result).toBe(true);
      expect(mockCache.get).toHaveBeenCalled();
    });

    it('should query database if cache misses', async () => {
      (featureFlagService as any).localCache.delete('aiAssistant');
      mockCache.get.mockResolvedValue(null);
      mockPrisma.featureFlag.findUnique.mockResolvedValue({
        key: 'aiAssistant',
        enabled: true,
      });

      const result = await featureFlagService.isEnabled('aiAssistant');

      expect(result).toBe(true);
      expect(mockPrisma.featureFlag.findUnique).toHaveBeenCalledWith({
        where: { key: 'aiAssistant' },
      });
    });

    // Regression: the database fallback wrote into the local cache outside
    // the snapshot machinery, so a process that never runs initialize()
    // (no poll, no event install) kept that value forever.
    it('does not pin a database fallback value in the local cache', async () => {
      (featureFlagService as any).localCache.delete('aiAssistant');
      mockCache.get.mockResolvedValue(null);
      mockPrisma.featureFlag.findUnique.mockResolvedValueOnce({ key: 'aiAssistant', enabled: true });

      await expect(featureFlagService.isEnabled('aiAssistant')).resolves.toBe(true);

      mockPrisma.featureFlag.findUnique.mockResolvedValueOnce({ key: 'aiAssistant', enabled: false });
      await expect(featureFlagService.isEnabled('aiAssistant')).resolves.toBe(false);
      expect((featureFlagService as any).localCache.has('aiAssistant')).toBe(false);
    });

    it('P2-8: does not pin a Redis cache hit into localCache when service is uninitialized', async () => {
      (featureFlagService as any).initialized = false;
      (featureFlagService as any).localCache = new Map();
      (featureFlagService as any).snapshot = null;

      const flagsV1 = { aiAssistant: true };
      const flagsV2 = { aiAssistant: false };
      mockCache.get
        .mockResolvedValueOnce({
          generation: '5',
          digest: createHash('sha256').update(JSON.stringify(flagsV1)).digest('hex'),
          flags: flagsV1,
        })
        .mockResolvedValueOnce({
          generation: '6',
          digest: createHash('sha256').update(JSON.stringify(flagsV2)).digest('hex'),
          flags: flagsV2,
        });

      await expect(featureFlagService.isEnabled('aiAssistant')).resolves.toBe(true);
      expect((featureFlagService as any).localCache.has('aiAssistant')).toBe(false);
      await expect(featureFlagService.isEnabled('aiAssistant')).resolves.toBe(false);
    });

    it('should fall back to environment config if database misses', async () => {
      mockCache.get.mockResolvedValue(null);
      mockPrisma.featureFlag.findUnique.mockResolvedValue(null);

      const result = await featureFlagService.isEnabled('hardwareWalletSigning');

      // Should return env default
      expect(result).toBe(true);
    });

    it('should handle experimental flags in environment fallback', async () => {
      mockCache.get.mockResolvedValue(null);
      mockPrisma.featureFlag.findUnique.mockResolvedValue(null);

      const result = await featureFlagService.isEnabled('experimental.taprootAddresses');

      expect(result).toBe(false); // From mockConfig
    });

    it('returns false for unknown experimental key during environment fallback', async () => {
      mockCache.get.mockResolvedValue(null);
      mockPrisma.featureFlag.findUnique.mockResolvedValue(null);

      const result = await featureFlagService.isEnabled('experimental.unknownFlag' as any);

      expect(result).toBe(false);
    });

    it('returns false for unknown top-level key during environment fallback', async () => {
      mockCache.get.mockResolvedValue(null);
      mockPrisma.featureFlag.findUnique.mockResolvedValue(null);

      const result = await featureFlagService.isEnabled('unknownTopLevelFlag' as any);

      expect(result).toBe(false);
    });

    it('falls back to environment config when distributed cache and database lookups fail', async () => {
      (featureFlagService as any).localCache.delete('hardwareWalletSigning');
      mockCache.get.mockRejectedValueOnce(new Error('cache unavailable'));
      mockPrisma.featureFlag.findUnique.mockRejectedValueOnce(new Error('database unavailable'));

      const result = await featureFlagService.isEnabled('hardwareWalletSigning');

      expect(result).toBe(true);
      expect(mockPrisma.featureFlag.findUnique).toHaveBeenCalledWith({
        where: { key: 'hardwareWalletSigning' },
      });
    });
  });

  describe('setFlag', () => {
    const mockExistingFlag = {
      id: 'flag-1',
      key: 'aiAssistant',
      enabled: false,
      description: 'AI assistant feature',
      category: 'general',
      modifiedBy: 'system',
      updatedAt: new Date(),
    };

    beforeEach(async () => {
      mockPrisma.featureFlag.findUnique.mockResolvedValue(null);
      mockPrisma.featureFlag.findMany.mockResolvedValue([]);
      await featureFlagService.initialize();
    });

    it('should update flag and create audit entry', async () => {
      mockPrisma.featureFlag.findUnique.mockResolvedValue(mockExistingFlag);
      mockPrisma.featureFlag.update.mockResolvedValue({ ...mockExistingFlag, enabled: true });
      mockPrisma.featureFlagAudit.create.mockResolvedValue({});
      mockPrisma.featureFlag.findMany.mockResolvedValue([{ ...mockExistingFlag, enabled: true }]);

      await featureFlagService.setFlag('aiAssistant', true, {
        userId: 'admin-123',
        reason: 'Enable for testing',
        ipAddress: '192.168.1.1',
      });

      expect(mockPrisma.$transaction).toHaveBeenCalled();
    });

    it('should throw error if flag does not exist', async () => {
      mockPrisma.featureFlag.findUnique.mockResolvedValue(null);

      await expect(
        featureFlagService.setFlag('nonExistent' as any, true, {
          userId: 'admin-123',
        })
      ).rejects.toThrow("Feature flag 'nonExistent' does not exist");
    });

    it('should skip update if value unchanged', async () => {
      mockPrisma.featureFlag.findUnique.mockResolvedValue({
        ...mockExistingFlag,
        enabled: true, // Already true
      });

      await featureFlagService.setFlag('aiAssistant', true, {
        userId: 'admin-123',
      });

      // Transaction is called (for the read) but update/audit should not be called
      expect(mockPrisma.featureFlag.update).not.toHaveBeenCalled();
      expect(mockPrisma.featureFlagAudit.create).not.toHaveBeenCalled();
    });

    it('should invalidate cache after update', async () => {
      mockPrisma.featureFlag.findUnique.mockResolvedValue(mockExistingFlag);
      mockPrisma.featureFlag.update.mockResolvedValue({ ...mockExistingFlag, enabled: true });
      mockPrisma.featureFlagAudit.create.mockResolvedValue({});
      mockPrisma.featureFlag.findMany.mockResolvedValue([{ ...mockExistingFlag, enabled: true }]);

      await featureFlagService.setFlag('aiAssistant', true, {
        userId: 'admin-123',
      });

      expect(mockCache.set).toHaveBeenCalled();
      expect((featureFlagService as any).localCache.get('aiAssistant')).toBe(true);
    });

    it('should emit system:featureFlag.changed event on update', async () => {
      mockPrisma.featureFlag.findUnique.mockResolvedValue(mockExistingFlag);
      mockPrisma.featureFlag.update.mockResolvedValue({ ...mockExistingFlag, enabled: true });
      mockPrisma.featureFlagAudit.create.mockResolvedValue({});
      mockPrisma.featureFlag.findMany.mockResolvedValue([{ ...mockExistingFlag, enabled: true }]);

      await featureFlagService.setFlag('aiAssistant', true, {
        userId: 'admin-123',
      });

      expect(mockEventBus.emitAsync).toHaveBeenCalledWith('system:featureFlag.changed', expect.objectContaining({
        key: 'aiAssistant',
        enabled: true,
        previousValue: false,
        changedBy: 'admin-123',
        generation: '2',
        digest: expect.any(String),
        snapshot: expect.objectContaining({ aiAssistant: true }),
      }));
    });

    it('should not emit event when value is unchanged', async () => {
      mockPrisma.featureFlag.findUnique.mockResolvedValue({
        ...mockExistingFlag,
        enabled: true,
      });

      await featureFlagService.setFlag('aiAssistant', true, {
        userId: 'admin-123',
      });

      expect(mockEventBus.emitAsync).not.toHaveBeenCalled();
    });
  });

  describe('getAllFlags', () => {
    it('should return all flags with metadata', async () => {
      const mockFlags = [
        {
          key: 'hardwareWalletSigning',
          enabled: true,
          description: 'Hardware wallet support',
          category: 'general',
          modifiedBy: 'admin',
          updatedAt: new Date(),
        },
        {
          key: 'aiAssistant',
          enabled: false,
          description: 'AI assistant',
          category: 'general',
          modifiedBy: 'system',
          updatedAt: new Date(),
        },
      ];
      mockPrisma.featureFlag.findMany.mockResolvedValue(mockFlags);

      const result = await featureFlagService.getAllFlags();

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual(
        expect.objectContaining({
          key: 'hardwareWalletSigning',
          enabled: true,
          source: 'database',
        })
      );
    });

    it('should order flags by category and key', async () => {
      mockPrisma.featureFlag.findMany.mockResolvedValue([]);

      await featureFlagService.getAllFlags();

      expect(mockPrisma.featureFlag.findMany).toHaveBeenCalledWith({
        orderBy: [{ category: 'asc' }, { key: 'asc' }],
      });
    });

    it('includes side-effect metadata for flags that have runtime effects', async () => {
      mockPrisma.featureFlag.findMany.mockResolvedValue([
        {
          key: 'treasuryAutopilot',
          enabled: true,
          description: 'Enable Treasury Autopilot consolidation jobs',
          category: 'general',
          modifiedBy: 'admin',
          updatedAt: new Date(),
        },
      ]);

      const [flag] = await featureFlagService.getAllFlags();

      expect(flag).toEqual(
        expect.objectContaining({
          key: 'treasuryAutopilot',
          hasSideEffects: true,
          sideEffectDescription: expect.stringContaining('starts or stops background consolidation jobs'),
        })
      );
    });

    it('keeps side-effect metadata empty for normal flags', async () => {
      mockPrisma.featureFlag.findMany.mockResolvedValue([
        {
          key: 'aiAssistant',
          enabled: true,
          description: 'Enable AI-powered transaction analysis',
          category: 'general',
          modifiedBy: 'admin',
          updatedAt: new Date(),
        },
      ]);

      const [flag] = await featureFlagService.getAllFlags();

      expect(flag).toEqual(
        expect.objectContaining({
          key: 'aiAssistant',
          hasSideEffects: undefined,
          sideEffectDescription: null,
        })
      );
    });
  });

  describe('getAuditLog', () => {
    it('should return audit entries for specific flag', async () => {
      const mockAuditEntries = [
        {
          id: 'audit-1',
          key: 'aiAssistant',
          previousValue: false,
          newValue: true,
          changedBy: 'admin-123',
          reason: 'Enable for testing',
          ipAddress: '192.168.1.1',
          createdAt: new Date(),
        },
      ];
      mockPrisma.featureFlagAudit.findMany.mockResolvedValue(mockAuditEntries);

      const result = await featureFlagService.getAuditLog('aiAssistant');

      expect(mockPrisma.featureFlagAudit.findMany).toHaveBeenCalledWith({
        where: { key: 'aiAssistant' },
        orderBy: { createdAt: 'desc' },
        take: 50,
        skip: 0,
      });
      expect(result).toHaveLength(1);
      expect(result[0].key).toBe('aiAssistant');
    });

    it('should return all audit entries when no key specified', async () => {
      mockPrisma.featureFlagAudit.findMany.mockResolvedValue([]);

      await featureFlagService.getAuditLog();

      expect(mockPrisma.featureFlagAudit.findMany).toHaveBeenCalledWith({
        where: undefined,
        orderBy: { createdAt: 'desc' },
        take: 50,
        skip: 0,
      });
    });

    it('should respect limit parameter', async () => {
      mockPrisma.featureFlagAudit.findMany.mockResolvedValue([]);

      await featureFlagService.getAuditLog('aiAssistant', 10);

      expect(mockPrisma.featureFlagAudit.findMany).toHaveBeenCalledWith({
        where: { key: 'aiAssistant' },
        orderBy: { createdAt: 'desc' },
        take: 10,
        skip: 0,
      });
    });
  });

  describe('getFlag', () => {
    it('should return flag info by key', async () => {
      mockPrisma.featureFlag.findUnique.mockResolvedValue({
        key: 'aiAssistant',
        enabled: true,
        description: 'AI assistant feature',
        category: 'general',
        modifiedBy: 'admin',
        updatedAt: new Date(),
      });

      const result = await featureFlagService.getFlag('aiAssistant');

      expect(result).toEqual(
        expect.objectContaining({
          key: 'aiAssistant',
          enabled: true,
          source: 'database',
        })
      );
    });

    it('should return null for non-existent flag', async () => {
      mockPrisma.featureFlag.findUnique.mockResolvedValue(null);

      const result = await featureFlagService.getFlag('nonExistent' as any);

      expect(result).toBeNull();
    });

    it('includes side-effect metadata for treasuryAutopilot', async () => {
      mockPrisma.featureFlag.findUnique.mockResolvedValue({
        key: 'treasuryAutopilot',
        enabled: true,
        description: 'Enable Treasury Autopilot consolidation jobs',
        category: 'general',
        modifiedBy: 'admin',
        updatedAt: new Date(),
      });

      const result = await featureFlagService.getFlag('treasuryAutopilot');

      expect(result).toEqual(
        expect.objectContaining({
          hasSideEffects: true,
          sideEffectDescription: expect.stringContaining('starts or stops background consolidation jobs'),
        })
      );
    });
  });

  describe('resetToDefault', () => {
    beforeEach(async () => {
      mockPrisma.featureFlag.findUnique.mockResolvedValue(null);
      mockPrisma.featureFlag.findMany.mockResolvedValue([]);
      await featureFlagService.initialize();
    });

    it('should reset flag to environment default', async () => {
      const mockFlag = {
        id: 'flag-1',
        key: 'hardwareWalletSigning',
        enabled: false, // Changed from true default
        description: 'Hardware wallet support',
        category: 'general',
        modifiedBy: 'admin',
        updatedAt: new Date(),
      };
      mockPrisma.featureFlag.findUnique.mockResolvedValue(mockFlag);
      mockPrisma.featureFlag.update.mockResolvedValue({ ...mockFlag, enabled: true });
      mockPrisma.featureFlagAudit.create.mockResolvedValue({});

      await featureFlagService.resetToDefault('hardwareWalletSigning', {
        userId: 'admin-123',
      });

      // Should be called with the env default (true)
      expect(mockPrisma.$transaction).toHaveBeenCalled();
    });

    it('should handle experimental flags', async () => {
      const mockFlag = {
        id: 'flag-1',
        key: 'experimental.taprootAddresses',
        enabled: true, // Changed from false default
        description: 'Taproot support',
        category: 'experimental',
        modifiedBy: 'admin',
        updatedAt: new Date(),
      };
      mockPrisma.featureFlag.findUnique.mockResolvedValue(mockFlag);
      mockPrisma.featureFlag.update.mockResolvedValue({ ...mockFlag, enabled: false });
      mockPrisma.featureFlagAudit.create.mockResolvedValue({});

      await featureFlagService.resetToDefault('experimental.taprootAddresses', {
        userId: 'admin-123',
      });

      expect(mockPrisma.$transaction).toHaveBeenCalled();
    });

    it('uses false default for unknown experimental keys', async () => {
      const mockFlag = {
        id: 'flag-unknown-exp',
        key: 'experimental.unknownFlag',
        enabled: true,
        description: null,
        category: 'experimental',
        modifiedBy: 'admin',
        updatedAt: new Date(),
      };
      mockPrisma.featureFlag.findUnique.mockResolvedValue(mockFlag);
      mockPrisma.featureFlag.update.mockResolvedValue({ ...mockFlag, enabled: false });
      mockPrisma.featureFlagAudit.create.mockResolvedValue({});

      await featureFlagService.resetToDefault('experimental.unknownFlag' as any, {
        userId: 'admin-123',
      });

      expect(mockPrisma.featureFlag.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ enabled: false }),
        })
      );
    });

    it('uses false default for unknown top-level keys', async () => {
      const mockFlag = {
        id: 'flag-unknown-top',
        key: 'unknownTopLevelFlag',
        enabled: true,
        description: null,
        category: 'general',
        modifiedBy: 'admin',
        updatedAt: new Date(),
      };
      mockPrisma.featureFlag.findUnique.mockResolvedValue(mockFlag);
      mockPrisma.featureFlag.update.mockResolvedValue({ ...mockFlag, enabled: false });
      mockPrisma.featureFlagAudit.create.mockResolvedValue({});

      await featureFlagService.resetToDefault('unknownTopLevelFlag' as any, {
        userId: 'admin-123',
      });

      expect(mockPrisma.featureFlag.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ enabled: false }),
        })
      );
    });
  });

  describe('bulkUpdate', () => {
    beforeEach(async () => {
      mockPrisma.featureFlag.findUnique.mockResolvedValue(null);
      mockPrisma.featureFlag.findMany.mockResolvedValue([]);
      await featureFlagService.initialize();
    });

    it('should update multiple flags', async () => {
      const mockFlags = [
        { id: 'flag-1', key: 'aiAssistant', enabled: false },
        { id: 'flag-2', key: 'priceAlerts', enabled: false },
      ];

      let callIndex = 0;
      mockPrisma.featureFlag.findUnique.mockImplementation(() => {
        const flag = mockFlags[callIndex];
        callIndex = (callIndex + 1) % mockFlags.length;
        return Promise.resolve(flag);
      });
      mockPrisma.featureFlag.update.mockResolvedValue({});
      mockPrisma.featureFlagAudit.create.mockResolvedValue({});

      await featureFlagService.bulkUpdate(
        [
          { key: 'aiAssistant', enabled: true },
          { key: 'priceAlerts', enabled: true },
        ],
        { userId: 'admin-123' }
      );

      // Should be called for each update
      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(3);
    });
  });
}
