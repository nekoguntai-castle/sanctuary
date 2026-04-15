import { describe, expect, it } from 'vitest';

import {
  aiInternalRequest,
  authHeader,
  internalIp,
  mockPrisma,
} from './aiInternalTestHarness';

export function registerAiInternalDataContracts(): void {
  describe('GET /internal/ai/tx/:id', () => {
    it('should return sanitized transaction data', async () => {
      const mockTx = {
        id: 'tx-123',
        amount: BigInt(-50000),
        type: 'send',
        blockTime: new Date('2024-01-15T10:30:00Z'),
        createdAt: new Date('2024-01-15T10:00:00Z'),
        confirmations: 6,
        walletId: 'wallet-123',
      };
      mockPrisma.transaction.findFirst.mockResolvedValue(mockTx);

      const res = await aiInternalRequest()
        .get('/internal/ai/tx/tx-123')
        .set('X-Forwarded-For', internalIp)
        .set('Authorization', authHeader);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        walletId: 'wallet-123',
        amount: 50000,
        direction: 'send',
        date: '2024-01-15T10:30:00.000Z',
        confirmations: 6,
      });
      expect(res.body).not.toHaveProperty('txid');
      expect(res.body).not.toHaveProperty('address');
    });

    it('should return direction as receive for positive amount', async () => {
      const mockTx = {
        id: 'tx-receive',
        amount: BigInt(100000),
        type: 'receive',
        blockTime: new Date('2024-01-15T10:30:00Z'),
        createdAt: new Date('2024-01-15T10:00:00Z'),
        confirmations: 3,
        walletId: 'wallet-123',
      };
      mockPrisma.transaction.findFirst.mockResolvedValue(mockTx);

      const res = await aiInternalRequest()
        .get('/internal/ai/tx/tx-receive')
        .set('X-Forwarded-For', internalIp)
        .set('Authorization', authHeader);

      expect(res.status).toBe(200);
      expect(res.body.direction).toBe('receive');
      expect(res.body.amount).toBe(100000);
    });

    it('should use createdAt when blockTime is null', async () => {
      const createdAt = new Date('2024-01-15T10:00:00Z');
      const mockTx = {
        id: 'tx-unconfirmed',
        amount: BigInt(10000),
        type: 'receive',
        blockTime: null,
        createdAt,
        confirmations: 0,
        walletId: 'wallet-123',
      };
      mockPrisma.transaction.findFirst.mockResolvedValue(mockTx);

      const res = await aiInternalRequest()
        .get('/internal/ai/tx/tx-unconfirmed')
        .set('X-Forwarded-For', internalIp)
        .set('Authorization', authHeader);

      expect(res.status).toBe(200);
      expect(res.body.date).toBe('2024-01-15T10:00:00.000Z');
    });

    it('should return 404 for non-existent transaction', async () => {
      mockPrisma.transaction.findFirst.mockResolvedValue(null);

      const res = await aiInternalRequest()
        .get('/internal/ai/tx/non-existent')
        .set('X-Forwarded-For', internalIp)
        .set('Authorization', authHeader);

      expect(res.status).toBe(404);
      expect(res.body.code).toBe('NOT_FOUND');
    });

    it('should return 401 without authentication', async () => {
      const res = await aiInternalRequest()
        .get('/internal/ai/tx/tx-123')
        .set('X-Forwarded-For', internalIp);

      expect(res.status).toBe(401);
    });

    it('should include userId in query for access check', async () => {
      mockPrisma.transaction.findFirst.mockResolvedValue(null);

      await aiInternalRequest()
        .get('/internal/ai/tx/tx-123')
        .set('X-Forwarded-For', internalIp)
        .set('Authorization', authHeader);

      expect(mockPrisma.transaction.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: 'tx-123',
            wallet: expect.objectContaining({
              OR: expect.arrayContaining([
                expect.objectContaining({ users: expect.any(Object) }),
                expect.objectContaining({ group: expect.any(Object) }),
              ]),
            }),
          }),
        })
      );
    });

    it('should return 500 on database error', async () => {
      mockPrisma.transaction.findFirst.mockRejectedValue(new Error('Database error'));

      const res = await aiInternalRequest()
        .get('/internal/ai/tx/tx-123')
        .set('X-Forwarded-For', internalIp)
        .set('Authorization', authHeader);

      expect(res.status).toBe(500);
      expect(res.body.code).toBe('INTERNAL_ERROR');
    });
  });

  describe('GET /internal/ai/wallet/:id/labels', () => {
    it('should return wallet labels', async () => {
      mockPrisma.wallet.findFirst.mockResolvedValue({ id: 'wallet-123', name: 'Test' });
      mockPrisma.label.findMany.mockResolvedValue([
        { name: 'Exchange' },
        { name: 'Mining' },
        { name: 'Salary' },
      ]);

      const res = await aiInternalRequest()
        .get('/internal/ai/wallet/wallet-123/labels')
        .set('X-Forwarded-For', internalIp)
        .set('Authorization', authHeader);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        labels: ['Exchange', 'Mining', 'Salary'],
      });
    });

    it('should return empty array when wallet has no labels', async () => {
      mockPrisma.wallet.findFirst.mockResolvedValue({ id: 'wallet-123' });
      mockPrisma.label.findMany.mockResolvedValue([]);

      const res = await aiInternalRequest()
        .get('/internal/ai/wallet/wallet-123/labels')
        .set('X-Forwarded-For', internalIp)
        .set('Authorization', authHeader);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ labels: [] });
    });

    it('should return 404 for non-existent wallet', async () => {
      mockPrisma.wallet.findFirst.mockResolvedValue(null);

      const res = await aiInternalRequest()
        .get('/internal/ai/wallet/non-existent/labels')
        .set('X-Forwarded-For', internalIp)
        .set('Authorization', authHeader);

      expect(res.status).toBe(404);
      expect(res.body.code).toBe('NOT_FOUND');
    });

    it('should limit labels to 50', async () => {
      mockPrisma.wallet.findFirst.mockResolvedValue({ id: 'wallet-123' });
      mockPrisma.label.findMany.mockResolvedValue([]);

      await aiInternalRequest()
        .get('/internal/ai/wallet/wallet-123/labels')
        .set('X-Forwarded-For', internalIp)
        .set('Authorization', authHeader);

      expect(mockPrisma.label.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 50,
          orderBy: { createdAt: 'desc' },
        })
      );
    });

    it('should return 401 without authentication', async () => {
      const res = await aiInternalRequest()
        .get('/internal/ai/wallet/wallet-123/labels')
        .set('X-Forwarded-For', internalIp);

      expect(res.status).toBe(401);
    });

    it('should return 500 on database error', async () => {
      mockPrisma.wallet.findFirst.mockRejectedValue(new Error('Database error'));

      const res = await aiInternalRequest()
        .get('/internal/ai/wallet/wallet-123/labels')
        .set('X-Forwarded-For', internalIp)
        .set('Authorization', authHeader);

      expect(res.status).toBe(500);
      expect(res.body.code).toBe('INTERNAL_ERROR');
    });
  });

  describe('GET /internal/ai/wallet/:id/context', () => {
    it('should return wallet context with stats', async () => {
      mockPrisma.wallet.findFirst.mockResolvedValue({ id: 'wallet-123' });
      mockPrisma.label.findMany.mockResolvedValue([
        { name: 'Exchange' },
        { name: 'Mining' },
      ]);
      mockPrisma.transaction.count.mockResolvedValue(150);
      mockPrisma.address.count.mockResolvedValue(25);
      mockPrisma.uTXO.count.mockResolvedValue(10);

      const res = await aiInternalRequest()
        .get('/internal/ai/wallet/wallet-123/context')
        .set('X-Forwarded-For', internalIp)
        .set('Authorization', authHeader);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        labels: ['Exchange', 'Mining'],
        stats: {
          transactionCount: 150,
          addressCount: 25,
          utxoCount: 10,
        },
      });
    });

    it('should NOT include balance or addresses', async () => {
      mockPrisma.wallet.findFirst.mockResolvedValue({
        id: 'wallet-123',
        balance: BigInt(5000000),
      });
      mockPrisma.label.findMany.mockResolvedValue([]);
      mockPrisma.transaction.count.mockResolvedValue(0);
      mockPrisma.address.count.mockResolvedValue(5);
      mockPrisma.uTXO.count.mockResolvedValue(0);

      const res = await aiInternalRequest()
        .get('/internal/ai/wallet/wallet-123/context')
        .set('X-Forwarded-For', internalIp)
        .set('Authorization', authHeader);

      expect(res.status).toBe(200);
      expect(res.body).not.toHaveProperty('balance');
      expect(res.body).not.toHaveProperty('addresses');
      expect(res.body.stats).not.toHaveProperty('balance');
    });

    it('should return 404 for non-existent wallet', async () => {
      mockPrisma.wallet.findFirst.mockResolvedValue(null);

      const res = await aiInternalRequest()
        .get('/internal/ai/wallet/non-existent/context')
        .set('X-Forwarded-For', internalIp)
        .set('Authorization', authHeader);

      expect(res.status).toBe(404);
      expect(res.body.code).toBe('NOT_FOUND');
    });

    it('should limit labels to 20', async () => {
      mockPrisma.wallet.findFirst.mockResolvedValue({ id: 'wallet-123' });
      mockPrisma.label.findMany.mockResolvedValue([]);
      mockPrisma.transaction.count.mockResolvedValue(0);
      mockPrisma.address.count.mockResolvedValue(0);
      mockPrisma.uTXO.count.mockResolvedValue(0);

      await aiInternalRequest()
        .get('/internal/ai/wallet/wallet-123/context')
        .set('X-Forwarded-For', internalIp)
        .set('Authorization', authHeader);

      expect(mockPrisma.label.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 20,
        })
      );
    });

    it('should return 401 without authentication', async () => {
      const res = await aiInternalRequest()
        .get('/internal/ai/wallet/wallet-123/context')
        .set('X-Forwarded-For', internalIp);

      expect(res.status).toBe(401);
    });

    it('should return 500 on database error', async () => {
      mockPrisma.wallet.findFirst.mockResolvedValue({ id: 'wallet-123' });
      mockPrisma.transaction.count.mockRejectedValue(new Error('Count failed'));

      const res = await aiInternalRequest()
        .get('/internal/ai/wallet/wallet-123/context')
        .set('X-Forwarded-For', internalIp)
        .set('Authorization', authHeader);

      expect(res.status).toBe(500);
      expect(res.body.code).toBe('INTERNAL_ERROR');
    });

    it('should handle empty wallet', async () => {
      mockPrisma.wallet.findFirst.mockResolvedValue({ id: 'empty-wallet' });
      mockPrisma.label.findMany.mockResolvedValue([]);
      mockPrisma.transaction.count.mockResolvedValue(0);
      mockPrisma.address.count.mockResolvedValue(0);
      mockPrisma.uTXO.count.mockResolvedValue(0);

      const res = await aiInternalRequest()
        .get('/internal/ai/wallet/empty-wallet/context')
        .set('X-Forwarded-For', internalIp)
        .set('Authorization', authHeader);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        labels: [],
        stats: {
          transactionCount: 0,
          addressCount: 0,
          utxoCount: 0,
        },
      });
    });
  });

  describe('Data Policy Compliance', () => {
    it('should verify transaction response follows data policy', async () => {
      const mockTx = {
        id: 'tx-policy',
        txid: 'abc123def456...',
        amount: BigInt(50000),
        type: 'receive',
        blockTime: new Date('2024-01-15T10:30:00Z'),
        createdAt: new Date('2024-01-15T10:00:00Z'),
        confirmations: 6,
        walletId: 'wallet-123',
        address: 'bc1q...sensitive',
      };
      mockPrisma.transaction.findFirst.mockResolvedValue(mockTx);

      const res = await aiInternalRequest()
        .get('/internal/ai/tx/tx-policy')
        .set('X-Forwarded-For', internalIp)
        .set('Authorization', authHeader);

      const allowedFields = ['walletId', 'amount', 'direction', 'date', 'confirmations'];
      allowedFields.forEach(field => {
        expect(res.body).toHaveProperty(field);
      });

      const forbiddenFields = ['address', 'txid', 'privateKey', 'password', 'seed', 'xpriv', 'id'];
      forbiddenFields.forEach(field => {
        expect(res.body).not.toHaveProperty(field);
      });
    });

    it('should verify wallet context follows data policy', async () => {
      mockPrisma.wallet.findFirst.mockResolvedValue({
        id: 'wallet-policy',
        balance: BigInt(5000000),
        xpub: 'xpub...secret',
      });
      mockPrisma.label.findMany.mockResolvedValue([{ name: 'Test' }]);
      mockPrisma.transaction.count.mockResolvedValue(100);
      mockPrisma.address.count.mockResolvedValue(20);
      mockPrisma.uTXO.count.mockResolvedValue(5);

      const res = await aiInternalRequest()
        .get('/internal/ai/wallet/wallet-policy/context')
        .set('X-Forwarded-For', internalIp)
        .set('Authorization', authHeader);

      expect(res.body).toHaveProperty('labels');
      expect(res.body).toHaveProperty('stats');
      expect(res.body.stats).toHaveProperty('transactionCount');
      expect(res.body.stats).toHaveProperty('addressCount');
      expect(res.body.stats).toHaveProperty('utxoCount');

      const forbiddenFields = ['balance', 'addresses', 'txids', 'privateKeys', 'xpub', 'id'];
      forbiddenFields.forEach(field => {
        expect(res.body).not.toHaveProperty(field);
        if (res.body.stats) {
          expect(res.body.stats).not.toHaveProperty(field);
        }
      });
    });
  });

  describe('Edge Cases', () => {
    it('should handle transaction with zero confirmations', async () => {
      const mockTx = {
        id: 'tx-unconfirmed',
        amount: BigInt(10000),
        type: 'receive',
        confirmations: 0,
        blockTime: null,
        createdAt: new Date(),
        walletId: 'wallet-123',
      };
      mockPrisma.transaction.findFirst.mockResolvedValue(mockTx);

      const res = await aiInternalRequest()
        .get('/internal/ai/tx/tx-unconfirmed')
        .set('X-Forwarded-For', internalIp)
        .set('Authorization', authHeader);

      expect(res.status).toBe(200);
      expect(res.body.confirmations).toBe(0);
    });

    it('should handle very large transaction amounts', async () => {
      const mockTx = {
        id: 'tx-large',
        amount: BigInt('2100000000000000'),
        type: 'receive',
        confirmations: 100,
        blockTime: new Date(),
        createdAt: new Date(),
        walletId: 'wallet-123',
      };
      mockPrisma.transaction.findFirst.mockResolvedValue(mockTx);

      const res = await aiInternalRequest()
        .get('/internal/ai/tx/tx-large')
        .set('X-Forwarded-For', internalIp)
        .set('Authorization', authHeader);

      expect(res.status).toBe(200);
      expect(res.body.amount).toBe(2100000000000000);
    });

    it('should handle zero amount (direction as receive)', async () => {
      const mockTx = {
        id: 'tx-zero',
        amount: BigInt(0),
        type: 'receive',
        confirmations: 1,
        blockTime: new Date(),
        createdAt: new Date(),
        walletId: 'wallet-123',
      };
      mockPrisma.transaction.findFirst.mockResolvedValue(mockTx);

      const res = await aiInternalRequest()
        .get('/internal/ai/tx/tx-zero')
        .set('X-Forwarded-For', internalIp)
        .set('Authorization', authHeader);

      expect(res.status).toBe(200);
      expect(res.body.direction).toBe('receive');
      expect(res.body.amount).toBe(0);
    });
  });
}
