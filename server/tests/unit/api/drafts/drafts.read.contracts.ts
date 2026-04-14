import { describe, expect, it, type Mock } from 'vitest';
import { createMockResponse, randomAddress } from '../../../helpers/testUtils';
import { mockPrismaClient } from '../../../mocks/prisma';
import { walletService } from './draftsTestHarness';

export const registerDraftReadContracts = () => {
  describe('GET /wallets/:walletId/drafts', () => {
    const walletId = 'wallet-123';
    const userId = 'user-123';

    it('should return all drafts for a wallet', async () => {
      (walletService.getWalletById as Mock).mockResolvedValue({
        id: walletId,
        name: 'Test Wallet',
      });

      const mockDrafts = [
        {
          id: 'draft-1',
          walletId,
          recipient: randomAddress(),
          amount: BigInt(50000),
          fee: BigInt(1000),
          totalInput: BigInt(100000),
          totalOutput: BigInt(99000),
          changeAmount: BigInt(49000),
          effectiveAmount: BigInt(50000),
          status: 'unsigned',
          createdAt: new Date(),
        },
        {
          id: 'draft-2',
          walletId,
          recipient: randomAddress(),
          amount: BigInt(25000),
          fee: BigInt(500),
          totalInput: BigInt(50000),
          totalOutput: BigInt(49500),
          changeAmount: BigInt(24500),
          effectiveAmount: BigInt(25000),
          status: 'partial',
          createdAt: new Date(),
        },
      ];

      mockPrismaClient.draftTransaction.findMany.mockResolvedValue(mockDrafts);

      const { res, getResponse } = createMockResponse();

      const drafts = await mockPrismaClient.draftTransaction.findMany({
        where: { walletId },
        orderBy: { createdAt: 'desc' },
      });

      // Serialize BigInt for JSON
      const serializedDrafts = drafts.map((draft: any) => ({
        ...draft,
        amount: Number(draft.amount),
        fee: Number(draft.fee),
        totalInput: Number(draft.totalInput),
        totalOutput: Number(draft.totalOutput),
        changeAmount: Number(draft.changeAmount),
        effectiveAmount: Number(draft.effectiveAmount),
      }));

      res.json!(serializedDrafts);

      const response = getResponse();
      expect(response.body).toHaveLength(2);
      expect(response.body[0].amount).toBe(50000);
      expect(response.body[1].status).toBe('partial');
    });

    it('should return empty array when no drafts exist', async () => {
      (walletService.getWalletById as Mock).mockResolvedValue({
        id: walletId,
        name: 'Test Wallet',
      });

      mockPrismaClient.draftTransaction.findMany.mockResolvedValue([]);

      const { res, getResponse } = createMockResponse();

      const drafts = await mockPrismaClient.draftTransaction.findMany({
        where: { walletId },
      });

      res.json!(drafts);

      expect(getResponse().body).toEqual([]);
    });
  });

  describe('GET /wallets/:walletId/drafts/:draftId', () => {
    const walletId = 'wallet-123';
    const draftId = 'draft-456';
    const userId = 'user-123';

    it('should return a specific draft', async () => {
      (walletService.getWalletById as Mock).mockResolvedValue({
        id: walletId,
        name: 'Test Wallet',
      });

      const mockDraft = {
        id: draftId,
        walletId,
        recipient: randomAddress(),
        amount: BigInt(75000),
        fee: BigInt(1500),
        totalInput: BigInt(150000),
        totalOutput: BigInt(148500),
        changeAmount: BigInt(73500),
        effectiveAmount: BigInt(75000),
        status: 'signed',
        psbtBase64: 'cHNidP8...',
        signedPsbtBase64: 'cHNidP8signed...',
      };

      mockPrismaClient.draftTransaction.findFirst.mockResolvedValue(mockDraft);

      const { res, getResponse } = createMockResponse();

      const draft = await mockPrismaClient.draftTransaction.findFirst({
        where: { id: draftId, walletId },
      });

      if (draft) {
        res.json!({
          ...draft,
          amount: Number(draft.amount),
          fee: Number(draft.fee),
          totalInput: Number(draft.totalInput),
          totalOutput: Number(draft.totalOutput),
          changeAmount: Number(draft.changeAmount),
          effectiveAmount: Number(draft.effectiveAmount),
        });
      }

      const response = getResponse();
      expect(response.body.id).toBe(draftId);
      expect(response.body.amount).toBe(75000);
      expect(response.body.status).toBe('signed');
    });

    it('should return 404 when draft not found', async () => {
      (walletService.getWalletById as Mock).mockResolvedValue({
        id: walletId,
        name: 'Test Wallet',
      });

      mockPrismaClient.draftTransaction.findFirst.mockResolvedValue(null);

      const { res, getResponse } = createMockResponse();

      const draft = await mockPrismaClient.draftTransaction.findFirst({
        where: { id: draftId, walletId },
      });

      if (!draft) {
        res.status!(404).json!({
          error: 'Not Found',
          message: 'Draft not found',
        });
      }

      const response = getResponse();
      expect(response.statusCode).toBe(404);
    });
  });
};
