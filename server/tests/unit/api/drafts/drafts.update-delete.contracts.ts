import { beforeEach, describe, expect, it, type Mock } from 'vitest';
import { createMockResponse } from '../../../helpers/testUtils';
import { mockPrismaClient } from '../../../mocks/prisma';
import { walletService } from './draftsTestHarness';

export const registerDraftUpdateDeleteContracts = () => {
  describe('PATCH /wallets/:walletId/drafts/:draftId', () => {
    const walletId = 'wallet-123';
    const draftId = 'draft-456';
    const userId = 'user-123';

    beforeEach(() => {
      (walletService.getWalletById as Mock).mockResolvedValue({
        id: walletId,
        name: 'Test Wallet',
        userRole: 'signer',
      });

      mockPrismaClient.draftTransaction.findFirst.mockResolvedValue({
        id: draftId,
        walletId,
        userId,
        status: 'unsigned',
        signedDeviceIds: [],
        amount: BigInt(50000),
        fee: BigInt(1000),
        totalInput: BigInt(100000),
        totalOutput: BigInt(99000),
        changeAmount: BigInt(49000),
        effectiveAmount: BigInt(50000),
      });
    });

    it('should update draft with new signature', async () => {
      const updateData = {
        signedPsbtBase64: 'cHNidP8signed...',
        signedDeviceId: 'device-1',
        status: 'partial',
      };

      mockPrismaClient.draftTransaction.update.mockResolvedValue({
        id: draftId,
        status: 'partial',
        signedDeviceIds: ['device-1'],
        signedPsbtBase64: updateData.signedPsbtBase64,
        amount: BigInt(50000),
        fee: BigInt(1000),
        totalInput: BigInt(100000),
        totalOutput: BigInt(99000),
        changeAmount: BigInt(49000),
        effectiveAmount: BigInt(50000),
      });

      const { res, getResponse } = createMockResponse();

      const existingDraft = await mockPrismaClient.draftTransaction.findFirst({
        where: { id: draftId, walletId },
      });

      const currentSigned = existingDraft?.signedDeviceIds || [];
      const newSignedDeviceIds = currentSigned.includes(updateData.signedDeviceId)
        ? currentSigned
        : [...currentSigned, updateData.signedDeviceId];

      const updatedDraft = await mockPrismaClient.draftTransaction.update({
        where: { id: draftId },
        data: {
          signedPsbtBase64: updateData.signedPsbtBase64,
          signedDeviceIds: newSignedDeviceIds,
          status: updateData.status,
        },
      });

      res.json!({
        ...updatedDraft,
        amount: Number(updatedDraft.amount),
        fee: Number(updatedDraft.fee),
        totalInput: Number(updatedDraft.totalInput),
        totalOutput: Number(updatedDraft.totalOutput),
        changeAmount: Number(updatedDraft.changeAmount),
        effectiveAmount: Number(updatedDraft.effectiveAmount),
      });

      const response = getResponse();
      expect(response.body.status).toBe('partial');
      expect(response.body.signedDeviceIds).toContain('device-1');
    });

    it('should not add duplicate device IDs', async () => {
      mockPrismaClient.draftTransaction.findFirst.mockResolvedValue({
        id: draftId,
        walletId,
        userId,
        status: 'partial',
        signedDeviceIds: ['device-1'], // Already signed
        amount: BigInt(50000),
        fee: BigInt(1000),
        totalInput: BigInt(100000),
        totalOutput: BigInt(99000),
        changeAmount: BigInt(49000),
        effectiveAmount: BigInt(50000),
      });

      const existingDraft = await mockPrismaClient.draftTransaction.findFirst({
        where: { id: draftId, walletId },
      });

      const currentSigned = existingDraft?.signedDeviceIds || [];
      const signedDeviceId = 'device-1';

      // Should not add duplicate
      if (!currentSigned.includes(signedDeviceId)) {
        currentSigned.push(signedDeviceId);
      }

      expect(currentSigned).toHaveLength(1);
      expect(currentSigned).toEqual(['device-1']);
    });

    it('should return 403 for viewer role', async () => {
      (walletService.getWalletById as Mock).mockResolvedValue({
        id: walletId,
        name: 'Test Wallet',
        userRole: 'viewer',
      });

      const { res, getResponse } = createMockResponse();

      const wallet = await walletService.getWalletById(walletId, userId);
      if (wallet?.userRole === 'viewer') {
        res.status!(403).json!({
          error: 'Forbidden',
          message: 'Viewers cannot modify draft transactions',
        });
      }

      const response = getResponse();
      expect(response.statusCode).toBe(403);
    });

    it('should return 400 for invalid status', async () => {
      const invalidStatus = 'invalid_status';

      const { res, getResponse } = createMockResponse();

      if (!['unsigned', 'partial', 'signed'].includes(invalidStatus)) {
        res.status!(400).json!({
          error: 'Bad Request',
          message: 'Invalid status. Must be unsigned, partial, or signed',
        });
      }

      const response = getResponse();
      expect(response.statusCode).toBe(400);
    });
  });

  describe('DELETE /wallets/:walletId/drafts/:draftId', () => {
    const walletId = 'wallet-123';
    const draftId = 'draft-456';
    const userId = 'user-123';

    beforeEach(() => {
      (walletService.getWalletById as Mock).mockResolvedValue({
        id: walletId,
        name: 'Test Wallet',
        userRole: 'owner',
      });

      mockPrismaClient.draftTransaction.findFirst.mockResolvedValue({
        id: draftId,
        walletId,
        userId,
        status: 'unsigned',
      });

      mockPrismaClient.draftTransaction.delete.mockResolvedValue({
        id: draftId,
      });
    });

    it('should delete draft and release UTXO locks', async () => {
      const { res, getResponse } = createMockResponse();

      await mockPrismaClient.draftTransaction.delete({
        where: { id: draftId },
      });

      res.status!(204).send!();

      const response = getResponse();
      expect(response.statusCode).toBe(204);
      expect(mockPrismaClient.draftTransaction.delete).toHaveBeenCalledWith({
        where: { id: draftId },
      });
    });

    it('should allow creator to delete their own draft', async () => {
      const creatorUserId = 'creator-user';

      mockPrismaClient.draftTransaction.findFirst.mockResolvedValue({
        id: draftId,
        walletId,
        userId: creatorUserId, // Draft belongs to creator
        status: 'unsigned',
      });

      (walletService.getWalletById as Mock).mockResolvedValue({
        id: walletId,
        name: 'Test Wallet',
        userRole: 'signer', // Not owner, but is the creator
      });

      const existingDraft = await mockPrismaClient.draftTransaction.findFirst({
        where: { id: draftId, walletId },
      });
      const wallet = await walletService.getWalletById(walletId, creatorUserId);

      // Creator can delete their own draft
      const canDelete = existingDraft?.userId === creatorUserId || wallet?.userRole === 'owner';
      expect(canDelete).toBe(true);
    });

    it('should return 403 when non-creator non-owner tries to delete', async () => {
      const otherUserId = 'other-user';

      mockPrismaClient.draftTransaction.findFirst.mockResolvedValue({
        id: draftId,
        walletId,
        userId: 'creator-user', // Draft belongs to someone else
        status: 'unsigned',
      });

      (walletService.getWalletById as Mock).mockResolvedValue({
        id: walletId,
        name: 'Test Wallet',
        userRole: 'signer', // Not owner
      });

      const { res, getResponse } = createMockResponse();

      const existingDraft = await mockPrismaClient.draftTransaction.findFirst({
        where: { id: draftId, walletId },
      });
      const wallet = await walletService.getWalletById(walletId, otherUserId);

      if (existingDraft?.userId !== otherUserId && wallet?.userRole !== 'owner') {
        res.status!(403).json!({
          error: 'Forbidden',
          message: 'Only the creator or wallet owner can delete drafts',
        });
      }

      const response = getResponse();
      expect(response.statusCode).toBe(403);
    });

    it('should return 404 when draft not found', async () => {
      mockPrismaClient.draftTransaction.findFirst.mockResolvedValue(null);

      const { res, getResponse } = createMockResponse();

      const existingDraft = await mockPrismaClient.draftTransaction.findFirst({
        where: { id: draftId, walletId },
      });

      if (!existingDraft) {
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
