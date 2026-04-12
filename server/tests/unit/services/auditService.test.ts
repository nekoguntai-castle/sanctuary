import { vi } from 'vitest';
/**
 * Audit Service Tests
 *
 * Tests for security audit logging, event tracking, and query capabilities.
 */

import { createMockRequest } from '../../helpers/testUtils';

// Mock repository functions - defined before vi.mock
const mockCreate = vi.fn();
const mockFindMany = vi.fn();
const mockFindByUserId = vi.fn();
const mockDeleteOlderThan = vi.fn();
const mockCountByCategory = vi.fn();
const mockCountByAction = vi.fn();

// Mock the audit log repository
vi.mock('../../../src/repositories', () => ({
  auditLogRepository: {
    create: (...args: unknown[]) => mockCreate(...args),
    findMany: (...args: unknown[]) => mockFindMany(...args),
    findByUserId: (...args: unknown[]) => mockFindByUserId(...args),
    findByCategory: vi.fn(),
    findFailedActions: vi.fn(),
    findRecent: vi.fn(),
    countByCategory: (...args: unknown[]) => mockCountByCategory(...args),
    countByAction: (...args: unknown[]) => mockCountByAction(...args),
    deleteOlderThan: (...args: unknown[]) => mockDeleteOlderThan(...args),
    logSuccess: vi.fn(),
    logFailure: vi.fn(),
  },
}));

// Mock logger
vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import {
  auditService,
  AuditCategory,
  AuditAction,
  getClientInfo,
} from '../../../src/services/auditService';

describe('Audit Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreate.mockReset();
    mockFindMany.mockReset();
    mockFindByUserId.mockReset();
    mockDeleteOlderThan.mockReset();
    mockCountByCategory.mockReset();
    mockCountByAction.mockReset();
  });

  describe('log', () => {
    it('should create an audit log entry', async () => {
      mockCreate.mockResolvedValue({
        id: 'audit-1',
        userId: 'user-123',
        username: 'testuser',
        action: AuditAction.LOGIN,
        category: AuditCategory.AUTH,
        success: true,
        createdAt: new Date(),
      });

      await auditService.log({
        userId: 'user-123',
        username: 'testuser',
        action: AuditAction.LOGIN,
        category: AuditCategory.AUTH,
      });

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-123',
          username: 'testuser',
          action: AuditAction.LOGIN,
          category: AuditCategory.AUTH,
          success: true,
        })
      );
    });

    it('should log failed events with error message', async () => {
      mockCreate.mockResolvedValue({
        id: 'audit-2',
        success: false,
      });

      await auditService.log({
        userId: 'user-123',
        username: 'testuser',
        action: AuditAction.LOGIN_FAILED,
        category: AuditCategory.AUTH,
        success: false,
        errorMsg: 'Invalid password',
      });

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          errorMsg: 'Invalid password',
        })
      );
    });

    it('should include IP address and user agent', async () => {
      mockCreate.mockResolvedValue({ id: 'audit-3' });

      await auditService.log({
        username: 'testuser',
        action: AuditAction.LOGIN,
        category: AuditCategory.AUTH,
        ipAddress: '192.168.1.100',
        userAgent: 'Mozilla/5.0...',
      });

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          ipAddress: '192.168.1.100',
          userAgent: 'Mozilla/5.0...',
        })
      );
    });

    it('should include details as JSON', async () => {
      mockCreate.mockResolvedValue({ id: 'audit-4' });

      await auditService.log({
        username: 'admin',
        action: AuditAction.USER_CREATE,
        category: AuditCategory.USER,
        details: {
          newUserId: 'new-user-1',
          newUsername: 'newuser',
        },
      });

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          details: {
            newUserId: 'new-user-1',
            newUsername: 'newuser',
          },
        })
      );
    });

    it('should not throw when database write fails', async () => {
      mockCreate.mockRejectedValue(new Error('DB error'));

      // Should not throw - audit failures should not break the application
      await expect(
        auditService.log({
          username: 'testuser',
          action: AuditAction.LOGIN,
          category: AuditCategory.AUTH,
        })
      ).resolves.not.toThrow();
    });

    it('should default success to true', async () => {
      mockCreate.mockResolvedValue({ id: 'audit-5' });

      await auditService.log({
        username: 'testuser',
        action: AuditAction.LOGIN,
        category: AuditCategory.AUTH,
      });

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
        })
      );
    });
  });

  describe('logFromRequest', () => {
    it('should extract user info from request', async () => {
      mockCreate.mockResolvedValue({ id: 'audit-6' });

      // Create a more complete mock request with socket
      const req = {
        ...createMockRequest({
          user: {
            userId: 'user-123',
            username: 'testuser',
            isAdmin: false,
          },
          headers: {
            'user-agent': 'Test Agent',
          },
          ip: '10.0.0.1',
        }),
        socket: { remoteAddress: '10.0.0.1' },
      };

      await auditService.logFromRequest(
        req as any,
        AuditAction.WALLET_CREATE,
        AuditCategory.WALLET,
        { details: { walletId: 'wallet-1' } }
      );

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-123',
          username: 'testuser',
          action: AuditAction.WALLET_CREATE,
          category: AuditCategory.WALLET,
        })
      );
    });

    it('should use anonymous for unauthenticated requests', async () => {
      mockCreate.mockResolvedValue({ id: 'audit-7' });

      // Create a more complete mock request with socket
      const req = {
        ...createMockRequest({}),
        socket: { remoteAddress: '127.0.0.1' },
      };

      await auditService.logFromRequest(
        req as any,
        AuditAction.LOGIN_FAILED,
        AuditCategory.AUTH
      );

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          username: 'anonymous',
        })
      );
    });
  });

  describe('query', () => {
    it('should return paginated results', async () => {
      const mockLogs = [
        { id: 'log-1', action: AuditAction.LOGIN },
        { id: 'log-2', action: AuditAction.LOGIN },
      ];

      mockFindMany.mockResolvedValue({ logs: mockLogs, total: 100 });

      const result = await auditService.query({ limit: 2, offset: 0 });

      expect(result.logs).toHaveLength(2);
      expect(result.total).toBe(100);
      expect(result.limit).toBe(2);
      expect(result.offset).toBe(0);
    });

    it('should filter by userId', async () => {
      mockFindMany.mockResolvedValue({ logs: [], total: 0 });

      await auditService.query({ userId: 'user-123' });

      expect(mockFindMany).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'user-123' }),
        expect.any(Object)
      );
    });

    it('should filter by username', async () => {
      mockFindMany.mockResolvedValue({ logs: [], total: 0 });

      await auditService.query({ username: 'admin' });

      expect(mockFindMany).toHaveBeenCalledWith(
        expect.objectContaining({ username: 'admin' }),
        expect.any(Object)
      );
    });

    it('should filter by category', async () => {
      mockFindMany.mockResolvedValue({ logs: [], total: 0 });

      await auditService.query({ category: AuditCategory.AUTH });

      expect(mockFindMany).toHaveBeenCalledWith(
        expect.objectContaining({ category: AuditCategory.AUTH }),
        expect.any(Object)
      );
    });

    it('should filter by date range', async () => {
      mockFindMany.mockResolvedValue({ logs: [], total: 0 });

      const startDate = new Date('2024-01-01');
      const endDate = new Date('2024-01-31');

      await auditService.query({ startDate, endDate });

      expect(mockFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          startDate,
          endDate,
        }),
        expect.any(Object)
      );
    });

    it('should filter by success status', async () => {
      mockFindMany.mockResolvedValue({ logs: [], total: 0 });

      await auditService.query({ success: false });

      expect(mockFindMany).toHaveBeenCalledWith(
        expect.objectContaining({ success: false }),
        expect.any(Object)
      );
    });

    it('should use default limit of 50', async () => {
      mockFindMany.mockResolvedValue({ logs: [], total: 0 });

      const result = await auditService.query({});

      expect(mockFindMany).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({
          limit: 50,
          offset: 0,
        })
      );
      expect(result.limit).toBe(50);
    });
  });

  describe('getForUser', () => {
    it('should return recent logs for a user', async () => {
      const mockLogs = [
        { id: 'log-1', userId: 'user-123' },
        { id: 'log-2', userId: 'user-123' },
      ];

      mockFindByUserId.mockResolvedValue(mockLogs);

      const result = await auditService.getForUser('user-123');

      expect(result).toHaveLength(2);
      expect(mockFindByUserId).toHaveBeenCalledWith('user-123', { limit: 20 });
    });

    it('should respect custom limit', async () => {
      mockFindByUserId.mockResolvedValue([]);

      await auditService.getForUser('user-123', 5);

      expect(mockFindByUserId).toHaveBeenCalledWith('user-123', { limit: 5 });
    });
  });

  describe('getFailedLogins', () => {
    it('should return failed login attempts since date', async () => {
      const since = new Date('2024-01-01');
      const mockLogs = [
        { id: 'fail-1', action: AuditAction.LOGIN_FAILED },
      ];

      mockFindMany.mockResolvedValue({ logs: mockLogs, total: 1 });

      const result = await auditService.getFailedLogins(since);

      expect(result).toHaveLength(1);
      expect(mockFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.LOGIN_FAILED,
          startDate: since,
          success: false,
        }),
        expect.objectContaining({ limit: 100 })
      );
    });
  });

  describe('getAdminActions', () => {
    it('should return admin actions', async () => {
      mockFindMany.mockResolvedValue({ logs: [], total: 0 });

      await auditService.getAdminActions();

      expect(mockFindMany).toHaveBeenCalledWith(
        { category: 'admin' },
        expect.objectContaining({
          limit: 50,
          offset: 0,
        })
      );
    });

    it('should support pagination', async () => {
      mockFindMany.mockResolvedValue({ logs: [], total: 0 });

      await auditService.getAdminActions(10, 20);

      expect(mockFindMany).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({
          limit: 10,
          offset: 20,
        })
      );
    });
  });

  describe('cleanup', () => {
    it('should delete logs older than specified date', async () => {
      const olderThan = new Date('2023-01-01');
      mockDeleteOlderThan.mockResolvedValue(500);

      const deleted = await auditService.cleanup(olderThan);

      expect(deleted).toBe(500);
      expect(mockDeleteOlderThan).toHaveBeenCalledWith(olderThan);
    });
  });

  describe('getStats', () => {
    it('should return statistics for the specified period', async () => {
      mockFindMany
        .mockResolvedValueOnce({ logs: [], total: 1000 })  // all events
        .mockResolvedValueOnce({ logs: [], total: 50 });    // failed events
      mockCountByCategory.mockResolvedValue({
        auth: 500,
        wallet: 300,
      });
      mockCountByAction.mockResolvedValue({});

      const stats = await auditService.getStats(30);

      expect(stats.totalEvents).toBe(1000);
      expect(stats.byCategory).toEqual({
        auth: 500,
        wallet: 300,
      });
      expect(mockCountByCategory).toHaveBeenCalledWith({ startDate: expect.any(Date) });
      expect(mockCountByAction).toHaveBeenCalledWith({ startDate: expect.any(Date) });
    });

    it('should count failed events', async () => {
      mockFindMany
        .mockResolvedValueOnce({ logs: [], total: 1000 })  // all events
        .mockResolvedValueOnce({ logs: [], total: 50 });    // failed events
      mockCountByCategory.mockResolvedValue({});
      mockCountByAction.mockResolvedValue({});

      const stats = await auditService.getStats();

      expect(stats.failedEvents).toBe(50);
    });

    it('should return top actions', async () => {
      mockFindMany
        .mockResolvedValueOnce({ logs: [], total: 100 })
        .mockResolvedValueOnce({ logs: [], total: 0 });
      mockCountByCategory.mockResolvedValue({});
      mockCountByAction.mockResolvedValue({
        'auth.login': 50,
        'wallet.create': 20,
      });

      const stats = await auditService.getStats();

      expect(stats.byAction).toEqual({
        'auth.login': 50,
        'wallet.create': 20,
      });
    });
  });
});

describe('getClientInfo', () => {
  it('should extract IP from socket remoteAddress', () => {
    const req = {
      headers: {},
      socket: { remoteAddress: '192.168.1.1' },
    } as any;

    const info = getClientInfo(req);

    expect(info.ipAddress).toBe('192.168.1.1');
  });

  it('should extract IP from x-forwarded-for header (single IP)', () => {
    const req = {
      headers: { 'x-forwarded-for': '10.0.0.1' },
      socket: { remoteAddress: '192.168.1.1' },
    } as any;

    const info = getClientInfo(req);

    expect(info.ipAddress).toBe('10.0.0.1');
  });

  it('should extract first IP from x-forwarded-for header (multiple IPs)', () => {
    const req = {
      headers: { 'x-forwarded-for': '10.0.0.1, 192.168.1.1, 172.16.0.1' },
      socket: { remoteAddress: '127.0.0.1' },
    } as any;

    const info = getClientInfo(req);

    expect(info.ipAddress).toBe('10.0.0.1');
  });

  it('should handle array x-forwarded-for header', () => {
    const req = {
      headers: { 'x-forwarded-for': ['10.0.0.1', '192.168.1.1'] },
      socket: { remoteAddress: '127.0.0.1' },
    } as any;

    const info = getClientInfo(req);

    expect(info.ipAddress).toBe('10.0.0.1');
  });

  it('should extract user agent', () => {
    const req = {
      headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0)' },
      socket: { remoteAddress: '127.0.0.1' },
    } as any;

    const info = getClientInfo(req);

    expect(info.userAgent).toBe('Mozilla/5.0 (Windows NT 10.0)');
  });

  it('should default to unknown for missing user agent', () => {
    const req = {
      headers: {},
      socket: { remoteAddress: '127.0.0.1' },
    } as any;

    const info = getClientInfo(req);

    expect(info.userAgent).toBe('unknown');
  });

  it('should default to unknown for missing IP', () => {
    const req = {
      headers: {},
      socket: {},
    } as any;

    const info = getClientInfo(req);

    expect(info.ipAddress).toBe('unknown');
  });
});

describe('Audit Actions and Categories', () => {
  describe('AuditCategory enum', () => {
    it('should have expected categories', () => {
      expect(AuditCategory.AUTH).toBe('auth');
      expect(AuditCategory.USER).toBe('user');
      expect(AuditCategory.WALLET).toBe('wallet');
      expect(AuditCategory.DEVICE).toBe('device');
      expect(AuditCategory.ADMIN).toBe('admin');
      expect(AuditCategory.BACKUP).toBe('backup');
      expect(AuditCategory.SYSTEM).toBe('system');
    });
  });

  describe('AuditAction enum', () => {
    it('should have auth-related actions', () => {
      expect(AuditAction.LOGIN).toBe('auth.login');
      expect(AuditAction.LOGIN_FAILED).toBe('auth.login_failed');
      expect(AuditAction.LOGOUT).toBe('auth.logout');
      expect(AuditAction.PASSWORD_CHANGE).toBe('auth.password_change');
    });

    it('should have 2FA-related actions', () => {
      expect(AuditAction.TWO_FACTOR_SETUP).toBe('auth.2fa_setup');
      expect(AuditAction.TWO_FACTOR_ENABLED).toBe('auth.2fa_enabled');
      expect(AuditAction.TWO_FACTOR_DISABLED).toBe('auth.2fa_disabled');
      expect(AuditAction.TWO_FACTOR_FAILED).toBe('auth.2fa_failed');
      expect(AuditAction.TWO_FACTOR_BACKUP_CODE_USED).toBe('auth.2fa_backup_code_used');
    });

    it('should have wallet-related actions', () => {
      expect(AuditAction.WALLET_CREATE).toBe('wallet.create');
      expect(AuditAction.WALLET_DELETE).toBe('wallet.delete');
      expect(AuditAction.WALLET_SHARE).toBe('wallet.share');
      expect(AuditAction.WALLET_EXPORT).toBe('wallet.export');
    });

    it('should have transaction-related actions', () => {
      expect(AuditAction.TRANSACTION_CREATE).toBe('wallet.transaction_create');
      expect(AuditAction.TRANSACTION_SIGN).toBe('wallet.transaction_sign');
      expect(AuditAction.TRANSACTION_BROADCAST).toBe('wallet.transaction_broadcast');
    });

    it('should have admin-related actions', () => {
      expect(AuditAction.NODE_CONFIG_UPDATE).toBe('admin.node_config_update');
      expect(AuditAction.GROUP_CREATE).toBe('admin.group_create');
      expect(AuditAction.SYSTEM_SETTING_UPDATE).toBe('admin.system_setting_update');
    });

    it('should have backup-related actions', () => {
      expect(AuditAction.BACKUP_CREATE).toBe('backup.create');
      expect(AuditAction.BACKUP_VALIDATE).toBe('backup.validate');
      expect(AuditAction.BACKUP_RESTORE).toBe('backup.restore');
    });
  });
});
