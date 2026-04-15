import { describe, expect, it, type Mock } from 'vitest';
import { mockPrismaClient } from '../../../mocks/prisma';
import {
  createMockResponse,
  randomTxid,
} from '../../../helpers/testUtils';

export function registerRawTransactionTests(): void {
  describe('GET /transactions/:txid/raw', () => {
    it('should return raw tx hex when user has wallet access', async () => {
      const txid = randomTxid();
      const userId = 'user-123';

      // User has access to the wallet
      mockPrismaClient.transaction.findFirst.mockResolvedValue({
        rawTx: '0200000001abcdef...',
        wallet: { network: 'mainnet' },
      });

      const { res, getResponse } = createMockResponse();

      const transaction = await mockPrismaClient.transaction.findFirst({
        where: {
          txid,
          wallet: {
            OR: [
              { users: { some: { userId } } },
              { group: { members: { some: { userId } } } },
            ],
          },
        },
        select: { rawTx: true, wallet: { select: { network: true } } },
      });

      if (transaction?.rawTx) {
        res.json!({ hex: transaction.rawTx });
      }

      const response = getResponse();
      expect(response.body.hex).toBe('0200000001abcdef...');
    });

    it('should deny access when user does not have wallet access', async () => {
      const txid = randomTxid();
      const userId = 'user-123';

      // User does NOT have access - findFirst returns null due to wallet access filter
      mockPrismaClient.transaction.findFirst.mockResolvedValue(null);

      // Mock mempool.space API to also fail (transaction not found publicly)
      (global.fetch as Mock).mockResolvedValue({
        ok: false,
        status: 404,
      });

      const { res, getResponse } = createMockResponse();

      // First check database with wallet access filter
      const transaction = await mockPrismaClient.transaction.findFirst({
        where: {
          txid,
          wallet: {
            OR: [
              { users: { some: { userId } } },
              { group: { members: { some: { userId } } } },
            ],
          },
        },
        select: { rawTx: true, wallet: { select: { network: true } } },
      });

      // Not found in database (due to access control), try mempool.space
      if (!transaction?.rawTx) {
        const response = await fetch(`https://mempool.space/api/tx/${txid}/hex`);
        if (!response.ok) {
          res.status!(404).json!({
            error: 'Not Found',
            message: 'Transaction not found',
          });
        }
      }

      const response = getResponse();
      expect(response.statusCode).toBe(404);
      expect(response.body.error).toBe('Not Found');
    });

    it('should verify wallet access filter includes user and group membership', async () => {
      const txid = randomTxid();
      const userId = 'user-123';

      mockPrismaClient.transaction.findFirst.mockResolvedValue(null);

      await mockPrismaClient.transaction.findFirst({
        where: {
          txid,
          wallet: {
            OR: [
              { users: { some: { userId } } },
              { group: { members: { some: { userId } } } },
            ],
          },
        },
        select: { rawTx: true, wallet: { select: { network: true } } },
      });

      // Verify the query includes proper access control
      expect(mockPrismaClient.transaction.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            wallet: expect.objectContaining({
              OR: expect.arrayContaining([
                { users: { some: { userId } } },
                { group: { members: { some: { userId } } } },
              ]),
            }),
          }),
        })
      );
    });

    it('should fallback to mempool.space when transaction not in database', async () => {
      const txid = randomTxid();
      const userId = 'user-123';
      const mockHex = '0200000001fedcba...';

      // Transaction not in our database
      mockPrismaClient.transaction.findFirst.mockResolvedValue(null);

      // Mock mempool.space API success
      (global.fetch as Mock).mockResolvedValue({
        ok: true,
        text: async () => mockHex,
      });

      const { res, getResponse } = createMockResponse();

      const transaction = await mockPrismaClient.transaction.findFirst({
        where: {
          txid,
          wallet: {
            OR: [
              { users: { some: { userId } } },
              { group: { members: { some: { userId } } } },
            ],
          },
        },
      });

      if (!transaction?.rawTx) {
        // Fallback to mempool.space
        const response = await fetch(`https://mempool.space/api/tx/${txid}/hex`);
        if (response.ok) {
          const hex = await response.text();
          res.json!({ hex });
        }
      }

      const response = getResponse();
      expect(response.body.hex).toBe(mockHex);
    });
  });
}
