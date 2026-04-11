/**
 * Maintenance Repository Tests
 *
 * Tests for maintenance data access layer operations including
 * backup export/restore, token revocation, migration tracking, and stats.
 */

import { vi, Mock } from 'vitest';

// Mock Prisma before importing repository
vi.mock('../../../src/models/prisma', () => ({
  __esModule: true,
  default: {
    priceData: { deleteMany: vi.fn() },
    feeEstimate: { deleteMany: vi.fn() },
    draftTransaction: {
      deleteMany: vi.fn(),
      count: vi.fn(),
    },
    refreshToken: { deleteMany: vi.fn(), groupBy: vi.fn() },
    wallet: { count: vi.fn() },
    revokedToken: {
      upsert: vi.fn(),
      findUnique: vi.fn(),
      count: vi.fn(),
      deleteMany: vi.fn(),
    },
    auditLog: { count: vi.fn() },
    pushDevice: { groupBy: vi.fn() },
    $executeRaw: vi.fn(),
    $queryRaw: vi.fn(),
    $transaction: vi.fn(),
  },
}));

import prisma from '../../../src/models/prisma';
import { maintenanceRepository } from '../../../src/repositories/maintenanceRepository';

describe('Maintenance Repository', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('exportTable', () => {
    it('should call findMany on the specified table', async () => {
      const rows = [{ id: '1' }, { id: '2' }];
      (prisma as any).users = { findMany: vi.fn().mockResolvedValue(rows) };

      const result = await maintenanceRepository.exportTable('users');

      expect((prisma as any).users.findMany).toHaveBeenCalled();
      expect(result).toEqual(rows);
    });
  });

  describe('exportTablePaginated', () => {
    it('should paginate without cursor', async () => {
      const rows = [{ id: 'a' }];
      (prisma as any).wallets = { findMany: vi.fn().mockResolvedValue(rows) };

      const result = await maintenanceRepository.exportTablePaginated('wallets', 50);

      expect((prisma as any).wallets.findMany).toHaveBeenCalledWith({
        take: 50,
        orderBy: { id: 'asc' },
      });
      expect(result).toEqual(rows);
    });

    it('should paginate with cursor', async () => {
      const rows = [{ id: 'b' }];
      (prisma as any).wallets = { findMany: vi.fn().mockResolvedValue(rows) };

      const result = await maintenanceRepository.exportTablePaginated('wallets', 50, 'cursor-id');

      expect((prisma as any).wallets.findMany).toHaveBeenCalledWith({
        take: 50,
        skip: 1,
        cursor: { id: 'cursor-id' },
        orderBy: { id: 'asc' },
      });
      expect(result).toEqual(rows);
    });
  });

  describe('deleteAllFromTable', () => {
    it('should call deleteMany on the table via tx client', async () => {
      const tx = { addresses: { deleteMany: vi.fn().mockResolvedValue({}) } };

      await maintenanceRepository.deleteAllFromTable(tx as any, 'addresses');

      expect(tx.addresses.deleteMany).toHaveBeenCalledWith({});
    });
  });

  describe('insertIntoTable', () => {
    it('should call createMany on the table via tx client', async () => {
      const records = [{ id: '1', name: 'test' }];
      const tx = { addresses: { createMany: vi.fn().mockResolvedValue({ count: 1 }) } };

      await maintenanceRepository.insertIntoTable(tx as any, 'addresses', records);

      expect(tx.addresses.createMany).toHaveBeenCalledWith({
        data: records,
        skipDuplicates: false,
      });
    });
  });

  describe('runInTransaction', () => {
    it('should delegate to prisma.$transaction', async () => {
      const fn = vi.fn().mockResolvedValue('result');
      (prisma.$transaction as Mock).mockResolvedValue('result');

      const result = await maintenanceRepository.runInTransaction(fn);

      expect(prisma.$transaction).toHaveBeenCalledWith(fn, undefined);
      expect(result).toBe('result');
    });

    it('should pass options to prisma.$transaction', async () => {
      const fn = vi.fn().mockResolvedValue('result');
      (prisma.$transaction as Mock).mockResolvedValue('result');

      await maintenanceRepository.runInTransaction(fn, { timeout: 60000 });

      expect(prisma.$transaction).toHaveBeenCalledWith(fn, { timeout: 60000 });
    });
  });

  describe('getExistingTables', () => {
    it('should return table names from pg_tables', async () => {
      const rows = [{ tablename: 'users' }, { tablename: 'wallets' }];
      (prisma.$queryRaw as Mock).mockResolvedValue(rows);

      const result = await maintenanceRepository.getExistingTables();

      expect(result).toEqual(['users', 'wallets']);
      expect(prisma.$queryRaw).toHaveBeenCalled();
    });

    it('should return empty array when no tables', async () => {
      (prisma.$queryRaw as Mock).mockResolvedValue([]);

      const result = await maintenanceRepository.getExistingTables();

      expect(result).toEqual([]);
    });
  });

  describe('getAppliedMigrations', () => {
    it('should return applied migrations', async () => {
      const migrations = [
        { id: '1', migration_name: '001_init', finished_at: new Date(), rolled_back_at: null },
      ];
      (prisma.$queryRaw as Mock).mockResolvedValue(migrations);

      const result = await maintenanceRepository.getAppliedMigrations();

      expect(result).toEqual(migrations);
      expect(prisma.$queryRaw).toHaveBeenCalled();
    });
  });

  describe('upsertRevokedToken', () => {
    it('should upsert a revoked token', async () => {
      (prisma.revokedToken.upsert as Mock).mockResolvedValue({});

      await maintenanceRepository.upsertRevokedToken({
        jti: 'token-jti',
        expiresAt: new Date('2025-01-01'),
        userId: 'user-1',
        reason: 'logout',
      });

      expect(prisma.revokedToken.upsert).toHaveBeenCalledWith({
        where: { jti: 'token-jti' },
        update: {
          userId: 'user-1',
          reason: 'logout',
          revokedAt: expect.any(Date),
          expiresAt: new Date('2025-01-01'),
        },
        create: {
          jti: 'token-jti',
          userId: 'user-1',
          reason: 'logout',
          expiresAt: new Date('2025-01-01'),
        },
      });
    });

    it('should handle upsert without optional fields', async () => {
      (prisma.revokedToken.upsert as Mock).mockResolvedValue({});

      await maintenanceRepository.upsertRevokedToken({
        jti: 'token-jti',
        expiresAt: new Date('2025-01-01'),
      });

      expect(prisma.revokedToken.upsert).toHaveBeenCalledWith({
        where: { jti: 'token-jti' },
        update: expect.objectContaining({
          userId: undefined,
          reason: undefined,
        }),
        create: expect.objectContaining({
          userId: undefined,
          reason: undefined,
        }),
      });
    });
  });

  describe('findRevokedToken', () => {
    it('should find a revoked token by jti', async () => {
      (prisma.revokedToken.findUnique as Mock).mockResolvedValue({ jti: 'token-jti' });

      const result = await maintenanceRepository.findRevokedToken('token-jti');

      expect(result).toEqual({ jti: 'token-jti' });
      expect(prisma.revokedToken.findUnique).toHaveBeenCalledWith({
        where: { jti: 'token-jti' },
        select: { jti: true },
      });
    });

    it('should return null when token not found', async () => {
      (prisma.revokedToken.findUnique as Mock).mockResolvedValue(null);

      const result = await maintenanceRepository.findRevokedToken('missing');

      expect(result).toBeNull();
    });
  });

  describe('countRevokedTokens', () => {
    it('should return the count of revoked tokens', async () => {
      (prisma.revokedToken.count as Mock).mockResolvedValue(42);

      const result = await maintenanceRepository.countRevokedTokens();

      expect(result).toBe(42);
      expect(prisma.revokedToken.count).toHaveBeenCalled();
    });
  });

  describe('deleteExpiredRevokedTokens', () => {
    it('should delete expired revoked tokens and return count', async () => {
      (prisma.revokedToken.deleteMany as Mock).mockResolvedValue({ count: 5 });

      const result = await maintenanceRepository.deleteExpiredRevokedTokens();

      expect(result).toBe(5);
      expect(prisma.revokedToken.deleteMany).toHaveBeenCalledWith({
        where: { expiresAt: { lt: expect.any(Date) } },
      });
    });
  });

  describe('deleteAllRefreshTokensForUser', () => {
    it('should delete all refresh tokens for a user', async () => {
      (prisma.refreshToken.deleteMany as Mock).mockResolvedValue({ count: 3 });

      const result = await maintenanceRepository.deleteAllRefreshTokensForUser('user-1');

      expect(result).toBe(3);
      expect(prisma.refreshToken.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
      });
    });
  });

  describe('deleteAllRevokedTokens', () => {
    it('should delete all revoked tokens', async () => {
      (prisma.revokedToken.deleteMany as Mock).mockResolvedValue({ count: 10 });

      await maintenanceRepository.deleteAllRevokedTokens();

      expect(prisma.revokedToken.deleteMany).toHaveBeenCalled();
    });
  });

  describe('getTableStats', () => {
    it('should return table stats from pg_stat_user_tables', async () => {
      const stats = [
        { relname: 'users', n_live_tup: BigInt(100) },
        { relname: 'wallets', n_live_tup: BigInt(50) },
      ];
      (prisma.$queryRaw as Mock).mockResolvedValue(stats);

      const result = await maintenanceRepository.getTableStats();

      expect(result).toEqual(stats);
      expect(prisma.$queryRaw).toHaveBeenCalled();
    });
  });

  describe('getPushDeviceCountsByPlatform', () => {
    it('should return push device counts grouped by platform', async () => {
      const counts = [
        { platform: 'ios', _count: { _all: 10 } },
        { platform: 'android', _count: { _all: 5 } },
      ];
      (prisma.pushDevice.groupBy as Mock).mockResolvedValue(counts);

      const result = await maintenanceRepository.getPushDeviceCountsByPlatform();

      expect(result).toEqual(counts);
      expect(prisma.pushDevice.groupBy).toHaveBeenCalledWith({
        by: ['platform'],
        _count: { _all: true },
      });
    });
  });

  describe('getActiveStats', () => {
    it('returns active user count from distinct sessions and total wallet count', async () => {
      (prisma.refreshToken.groupBy as Mock).mockResolvedValue([
        { userId: 'u1' },
        { userId: 'u2' },
        { userId: 'u3' },
      ]);
      (prisma.wallet.count as Mock).mockResolvedValue(7);

      const result = await maintenanceRepository.getActiveStats();

      expect(result).toEqual({ activeUserCount: 3, activeWalletCount: 7 });
      expect(prisma.refreshToken.groupBy).toHaveBeenCalledWith({
        by: ['userId'],
        where: { expiresAt: { gt: expect.any(Date) } },
      });
      expect(prisma.wallet.count).toHaveBeenCalled();
    });

    it('returns zero when no active sessions or wallets', async () => {
      (prisma.refreshToken.groupBy as Mock).mockResolvedValue([]);
      (prisma.wallet.count as Mock).mockResolvedValue(0);

      const result = await maintenanceRepository.getActiveStats();

      expect(result).toEqual({ activeUserCount: 0, activeWalletCount: 0 });
    });
  });
});
