/**
 * Audit Log Repository Tests
 *
 * Tests for audit log data access layer operations including
 * log creation, filtering, counting, and cleanup.
 */

import { vi, Mock } from 'vitest';

// Mock Prisma before importing repository
vi.mock('../../../src/models/prisma', () => ({
  __esModule: true,
  default: {
    auditLog: {
      create: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      groupBy: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}));

import prisma from '../../../src/models/prisma';
import { auditLogRepository, type AuditCategory } from '../../../src/repositories/auditLogRepository';

describe('Audit Log Repository', () => {
  const mockAuditLog = {
    id: 'audit-123',
    userId: 'user-456',
    username: 'testuser',
    action: 'login',
    category: 'auth' as AuditCategory,
    details: { method: 'password' },
    ipAddress: '192.168.1.1',
    userAgent: 'Mozilla/5.0',
    success: true,
    errorMsg: null,
    createdAt: new Date(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('create', () => {
    it('should create an audit log entry', async () => {
      (prisma.auditLog.create as Mock).mockResolvedValue(mockAuditLog);

      const result = await auditLogRepository.create({
        userId: 'user-456',
        username: 'testuser',
        action: 'login',
        category: 'auth',
        details: { method: 'password' },
        ipAddress: '192.168.1.1',
        userAgent: 'Mozilla/5.0',
        success: true,
      });

      expect(result).toEqual(mockAuditLog);
      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: {
          userId: 'user-456',
          username: 'testuser',
          action: 'login',
          category: 'auth',
          details: { method: 'password' },
          ipAddress: '192.168.1.1',
          userAgent: 'Mozilla/5.0',
          success: true,
          errorMsg: undefined,
        },
      });
    });

    it('should create failed audit log with error message', async () => {
      const failedLog = { ...mockAuditLog, success: false, errorMsg: 'Invalid password' };
      (prisma.auditLog.create as Mock).mockResolvedValue(failedLog);

      const result = await auditLogRepository.create({
        userId: 'user-456',
        username: 'testuser',
        action: 'login',
        category: 'auth',
        success: false,
        errorMsg: 'Invalid password',
      });

      expect(result.success).toBe(false);
      expect(result.errorMsg).toBe('Invalid password');
    });

    it('should use empty object for details when not provided', async () => {
      (prisma.auditLog.create as Mock).mockResolvedValue(mockAuditLog);

      await auditLogRepository.create({
        username: 'testuser',
        action: 'login',
        category: 'auth',
      });

      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          details: {},
        }),
      });
    });

    it('should default success to true when not provided', async () => {
      (prisma.auditLog.create as Mock).mockResolvedValue(mockAuditLog);

      await auditLogRepository.create({
        username: 'testuser',
        action: 'login',
        category: 'auth',
      });

      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          success: true,
        }),
      });
    });
  });

  describe('findMany', () => {
    it('should find audit logs without filters', async () => {
      const logs = [mockAuditLog, { ...mockAuditLog, id: 'audit-456' }];
      (prisma.auditLog.findMany as Mock).mockResolvedValue(logs);
      (prisma.auditLog.count as Mock).mockResolvedValue(2);

      const result = await auditLogRepository.findMany();

      expect(result.logs).toHaveLength(2);
      expect(result.total).toBe(2);
      expect(prisma.auditLog.findMany).toHaveBeenCalledWith({
        where: {},
        orderBy: { createdAt: 'desc' },
        take: 50,
        skip: 0,
      });
    });

    it('should filter by userId', async () => {
      (prisma.auditLog.findMany as Mock).mockResolvedValue([mockAuditLog]);
      (prisma.auditLog.count as Mock).mockResolvedValue(1);

      await auditLogRepository.findMany({ userId: 'user-456' });

      expect(prisma.auditLog.findMany).toHaveBeenCalledWith({
        where: { userId: 'user-456' },
        orderBy: { createdAt: 'desc' },
        take: 50,
        skip: 0,
      });
    });

    it('should filter by username with partial case-insensitive matching', async () => {
      (prisma.auditLog.findMany as Mock).mockResolvedValue([mockAuditLog]);
      (prisma.auditLog.count as Mock).mockResolvedValue(1);

      await auditLogRepository.findMany({ username: 'admin' });

      expect(prisma.auditLog.findMany).toHaveBeenCalledWith({
        where: {
          username: {
            contains: 'admin',
            mode: 'insensitive',
          },
        },
        orderBy: { createdAt: 'desc' },
        take: 50,
        skip: 0,
      });
    });

    it('should filter by action', async () => {
      (prisma.auditLog.findMany as Mock).mockResolvedValue([mockAuditLog]);
      (prisma.auditLog.count as Mock).mockResolvedValue(1);

      await auditLogRepository.findMany({ action: 'login' });

      expect(prisma.auditLog.findMany).toHaveBeenCalledWith({
        where: { action: 'login' },
        orderBy: { createdAt: 'desc' },
        take: 50,
        skip: 0,
      });
    });

    it('should filter by category', async () => {
      (prisma.auditLog.findMany as Mock).mockResolvedValue([mockAuditLog]);
      (prisma.auditLog.count as Mock).mockResolvedValue(1);

      await auditLogRepository.findMany({ category: 'auth' });

      expect(prisma.auditLog.findMany).toHaveBeenCalledWith({
        where: { category: 'auth' },
        orderBy: { createdAt: 'desc' },
        take: 50,
        skip: 0,
      });
    });

    it('should filter by success status', async () => {
      (prisma.auditLog.findMany as Mock).mockResolvedValue([mockAuditLog]);
      (prisma.auditLog.count as Mock).mockResolvedValue(1);

      await auditLogRepository.findMany({ success: true });

      expect(prisma.auditLog.findMany).toHaveBeenCalledWith({
        where: { success: true },
        orderBy: { createdAt: 'desc' },
        take: 50,
        skip: 0,
      });
    });

    it('should filter by date range with startDate only', async () => {
      const startDate = new Date('2024-01-01');
      (prisma.auditLog.findMany as Mock).mockResolvedValue([mockAuditLog]);
      (prisma.auditLog.count as Mock).mockResolvedValue(1);

      await auditLogRepository.findMany({ startDate });

      expect(prisma.auditLog.findMany).toHaveBeenCalledWith({
        where: { createdAt: { gte: startDate } },
        orderBy: { createdAt: 'desc' },
        take: 50,
        skip: 0,
      });
    });

    it('should filter by date range with endDate only', async () => {
      const endDate = new Date('2024-12-31');
      (prisma.auditLog.findMany as Mock).mockResolvedValue([mockAuditLog]);
      (prisma.auditLog.count as Mock).mockResolvedValue(1);

      await auditLogRepository.findMany({ endDate });

      expect(prisma.auditLog.findMany).toHaveBeenCalledWith({
        where: { createdAt: { lte: endDate } },
        orderBy: { createdAt: 'desc' },
        take: 50,
        skip: 0,
      });
    });

    it('should filter by date range with both dates', async () => {
      const startDate = new Date('2024-01-01');
      const endDate = new Date('2024-12-31');
      (prisma.auditLog.findMany as Mock).mockResolvedValue([mockAuditLog]);
      (prisma.auditLog.count as Mock).mockResolvedValue(1);

      await auditLogRepository.findMany({ startDate, endDate });

      expect(prisma.auditLog.findMany).toHaveBeenCalledWith({
        where: { createdAt: { gte: startDate, lte: endDate } },
        orderBy: { createdAt: 'desc' },
        take: 50,
        skip: 0,
      });
    });

    it('should apply pagination', async () => {
      (prisma.auditLog.findMany as Mock).mockResolvedValue([mockAuditLog]);
      (prisma.auditLog.count as Mock).mockResolvedValue(100);

      await auditLogRepository.findMany({}, { limit: 20, offset: 40 });

      expect(prisma.auditLog.findMany).toHaveBeenCalledWith({
        where: {},
        orderBy: { createdAt: 'desc' },
        take: 20,
        skip: 40,
      });
    });

    it('should preserve zero limit for count-only queries', async () => {
      (prisma.auditLog.findMany as Mock).mockResolvedValue([]);
      (prisma.auditLog.count as Mock).mockResolvedValue(100);

      await auditLogRepository.findMany({}, { limit: 0 });

      expect(prisma.auditLog.findMany).toHaveBeenCalledWith({
        where: {},
        orderBy: { createdAt: 'desc' },
        take: 0,
        skip: 0,
      });
    });

    it('should combine multiple filters', async () => {
      (prisma.auditLog.findMany as Mock).mockResolvedValue([mockAuditLog]);
      (prisma.auditLog.count as Mock).mockResolvedValue(1);

      await auditLogRepository.findMany({
        userId: 'user-456',
        action: 'login',
        category: 'auth',
        success: false,
      });

      expect(prisma.auditLog.findMany).toHaveBeenCalledWith({
        where: {
          userId: 'user-456',
          action: 'login',
          category: 'auth',
          success: false,
        },
        orderBy: { createdAt: 'desc' },
        take: 50,
        skip: 0,
      });
    });
  });

  describe('findByUserId', () => {
    it('should find audit logs for a user', async () => {
      const logs = [mockAuditLog];
      (prisma.auditLog.findMany as Mock).mockResolvedValue(logs);

      const result = await auditLogRepository.findByUserId('user-456');

      expect(result).toHaveLength(1);
      expect(prisma.auditLog.findMany).toHaveBeenCalledWith({
        where: { userId: 'user-456' },
        orderBy: { createdAt: 'desc' },
        take: 50,
        skip: 0,
      });
    });

    it('should apply pagination', async () => {
      (prisma.auditLog.findMany as Mock).mockResolvedValue([]);

      await auditLogRepository.findByUserId('user-456', { limit: 10, offset: 5 });

      expect(prisma.auditLog.findMany).toHaveBeenCalledWith({
        where: { userId: 'user-456' },
        orderBy: { createdAt: 'desc' },
        take: 10,
        skip: 5,
      });
    });
  });

  describe('findByCategory', () => {
    it('should find audit logs by category', async () => {
      const logs = [mockAuditLog];
      (prisma.auditLog.findMany as Mock).mockResolvedValue(logs);

      const result = await auditLogRepository.findByCategory('auth');

      expect(result).toHaveLength(1);
      expect(prisma.auditLog.findMany).toHaveBeenCalledWith({
        where: { category: 'auth' },
        orderBy: { createdAt: 'desc' },
        take: 50,
        skip: 0,
      });
    });

    it('should apply pagination', async () => {
      (prisma.auditLog.findMany as Mock).mockResolvedValue([]);

      await auditLogRepository.findByCategory('wallet', { limit: 25, offset: 50 });

      expect(prisma.auditLog.findMany).toHaveBeenCalledWith({
        where: { category: 'wallet' },
        orderBy: { createdAt: 'desc' },
        take: 25,
        skip: 50,
      });
    });
  });

  describe('findFailedActions', () => {
    it('should find failed audit logs', async () => {
      const failedLog = { ...mockAuditLog, success: false };
      (prisma.auditLog.findMany as Mock).mockResolvedValue([failedLog]);

      const result = await auditLogRepository.findFailedActions();

      expect(result).toHaveLength(1);
      expect(prisma.auditLog.findMany).toHaveBeenCalledWith({
        where: { success: false },
        orderBy: { createdAt: 'desc' },
        take: 50,
        skip: 0,
      });
    });

    it('should apply pagination', async () => {
      (prisma.auditLog.findMany as Mock).mockResolvedValue([]);

      await auditLogRepository.findFailedActions({ limit: 100, offset: 0 });

      expect(prisma.auditLog.findMany).toHaveBeenCalledWith({
        where: { success: false },
        orderBy: { createdAt: 'desc' },
        take: 100,
        skip: 0,
      });
    });
  });

  describe('findRecent', () => {
    it('should find recent audit logs with default limit', async () => {
      (prisma.auditLog.findMany as Mock).mockResolvedValue([mockAuditLog]);

      const result = await auditLogRepository.findRecent();

      expect(result).toHaveLength(1);
      expect(prisma.auditLog.findMany).toHaveBeenCalledWith({
        orderBy: { createdAt: 'desc' },
        take: 100,
      });
    });

    it('should find recent audit logs with custom limit', async () => {
      (prisma.auditLog.findMany as Mock).mockResolvedValue([mockAuditLog]);

      await auditLogRepository.findRecent(50);

      expect(prisma.auditLog.findMany).toHaveBeenCalledWith({
        orderBy: { createdAt: 'desc' },
        take: 50,
      });
    });
  });

  describe('countByAction', () => {
    it('should count audit logs by action', async () => {
      (prisma.auditLog.groupBy as Mock).mockResolvedValue([
        { action: 'login', _count: { action: 100 } },
        { action: 'logout', _count: { action: 50 } },
        { action: 'wallet_created', _count: { action: 25 } },
      ]);

      const result = await auditLogRepository.countByAction();

      expect(result).toEqual({
        login: 100,
        logout: 50,
        wallet_created: 25,
      });
    });

    it('should return empty object when no logs', async () => {
      (prisma.auditLog.groupBy as Mock).mockResolvedValue([]);

      const result = await auditLogRepository.countByAction();

      expect(result).toEqual({});
    });

    it('should count audit logs by action within a date range', async () => {
      const startDate = new Date('2024-01-01');
      (prisma.auditLog.groupBy as Mock).mockResolvedValue([
        { action: 'login', _count: { action: 10 } },
      ]);

      await auditLogRepository.countByAction({ startDate });

      expect(prisma.auditLog.groupBy).toHaveBeenCalledWith({
        by: ['action'],
        where: { createdAt: { gte: startDate } },
        _count: { action: true },
      });
    });
  });

  describe('countByCategory', () => {
    it('should count audit logs by category', async () => {
      (prisma.auditLog.groupBy as Mock).mockResolvedValue([
        { category: 'auth', _count: { category: 200 } },
        { category: 'wallet', _count: { category: 150 } },
        { category: 'admin', _count: { category: 50 } },
      ]);

      const result = await auditLogRepository.countByCategory();

      expect(result).toEqual({
        auth: 200,
        wallet: 150,
        admin: 50,
      });
    });

    it('should return empty object when no logs', async () => {
      (prisma.auditLog.groupBy as Mock).mockResolvedValue([]);

      const result = await auditLogRepository.countByCategory();

      expect(result).toEqual({});
    });

    it('should count audit logs by category within a date range', async () => {
      const startDate = new Date('2024-01-01');
      (prisma.auditLog.groupBy as Mock).mockResolvedValue([
        { category: 'auth', _count: { category: 10 } },
      ]);

      await auditLogRepository.countByCategory({ startDate });

      expect(prisma.auditLog.groupBy).toHaveBeenCalledWith({
        by: ['category'],
        where: { createdAt: { gte: startDate } },
        _count: { category: true },
      });
    });
  });

  describe('deleteOlderThan', () => {
    it('should delete old audit logs', async () => {
      const cutoffDate = new Date('2024-01-01');
      (prisma.auditLog.deleteMany as Mock).mockResolvedValue({ count: 500 });

      const count = await auditLogRepository.deleteOlderThan(cutoffDate);

      expect(count).toBe(500);
      expect(prisma.auditLog.deleteMany).toHaveBeenCalledWith({
        where: { createdAt: { lt: cutoffDate } },
      });
    });

    it('should return 0 when no logs to delete', async () => {
      (prisma.auditLog.deleteMany as Mock).mockResolvedValue({ count: 0 });

      const count = await auditLogRepository.deleteOlderThan(new Date());

      expect(count).toBe(0);
    });
  });

  describe('logSuccess', () => {
    it('should log a successful action', async () => {
      (prisma.auditLog.create as Mock).mockResolvedValue(mockAuditLog);

      const result = await auditLogRepository.logSuccess(
        'user-456',
        'testuser',
        'login',
        'auth',
        { method: 'password' },
        { ipAddress: '192.168.1.1', userAgent: 'Mozilla/5.0' }
      );

      expect(result).toEqual(mockAuditLog);
      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: 'user-456',
          username: 'testuser',
          action: 'login',
          category: 'auth',
          success: true,
        }),
      });
    });

    it('should log without context', async () => {
      (prisma.auditLog.create as Mock).mockResolvedValue(mockAuditLog);

      await auditLogRepository.logSuccess('user-456', 'testuser', 'login', 'auth');

      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          ipAddress: undefined,
          userAgent: undefined,
        }),
      });
    });

    it('should handle null userId', async () => {
      (prisma.auditLog.create as Mock).mockResolvedValue({ ...mockAuditLog, userId: null });

      await auditLogRepository.logSuccess(null, 'anonymous', 'page_view', 'system');

      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: null,
        }),
      });
    });
  });

  describe('logFailure', () => {
    it('should log a failed action', async () => {
      const failedLog = { ...mockAuditLog, success: false, errorMsg: 'Invalid credentials' };
      (prisma.auditLog.create as Mock).mockResolvedValue(failedLog);

      const result = await auditLogRepository.logFailure(
        'user-456',
        'testuser',
        'login',
        'auth',
        'Invalid credentials',
        { attemptCount: 3 },
        { ipAddress: '192.168.1.1' }
      );

      expect(result.success).toBe(false);
      expect(result.errorMsg).toBe('Invalid credentials');
      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          success: false,
          errorMsg: 'Invalid credentials',
        }),
      });
    });

    it('should log failure without details or context', async () => {
      (prisma.auditLog.create as Mock).mockResolvedValue({
        ...mockAuditLog,
        success: false,
        errorMsg: 'Error',
      });

      await auditLogRepository.logFailure(null, 'unknown', 'api_call', 'system', 'Error');

      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: null,
          success: false,
          errorMsg: 'Error',
        }),
      });
    });
  });
});
