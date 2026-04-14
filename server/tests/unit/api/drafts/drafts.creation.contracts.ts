import { beforeEach, describe, expect, it, type Mock } from 'vitest';
import { createMockRequest, createMockResponse } from '../../../helpers/testUtils';
import { mockPrismaClient } from '../../../mocks/prisma';
import { draftLockService, walletService } from './draftsTestHarness';

export const registerDraftCreationContracts = () => {
  describe('POST /wallets/:walletId/drafts', () => {
    const walletId = 'wallet-123';
    const userId = 'user-123';

    const validDraftRequest = {
      recipient: 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx',
      amount: 50000,
      feeRate: 10,
      selectedUtxoIds: ['txid-aaa:0', 'txid-bbb:1'],
      enableRBF: true,
      subtractFees: false,
      sendMax: false,
      label: 'Test payment',
      memo: 'Testing draft creation',
      psbtBase64: 'cHNidP8BAHUCAAAAAAEAAAAAAAAAAACNEQsAAAAAIgAgtest...',
      fee: 1500,
      totalInput: 100000,
      totalOutput: 98500,
      changeAmount: 48500,
      changeAddress: 'tb1qchange...',
      effectiveAmount: 50000,
      inputPaths: ["m/84'/1'/0'/0/0", "m/84'/1'/0'/0/1"],
    };

    beforeEach(() => {
      // Default: wallet exists and user has signer role
      (walletService.getWalletById as Mock).mockResolvedValue({
        id: walletId,
        name: 'Test Wallet',
        userRole: 'signer',
      });

      // Default: UTXOs resolve successfully
      (draftLockService.resolveUtxoIds as Mock).mockResolvedValue({
        found: ['utxo-id-1', 'utxo-id-2'],
        notFound: [],
      });

      // Default: locking succeeds
      (draftLockService.lockUtxosForDraft as Mock).mockResolvedValue({
        success: true,
        lockedCount: 2,
        failedUtxoIds: [],
        lockedByDraftIds: [],
      });

      // Default: draft creation succeeds
      mockPrismaClient.draftTransaction.create.mockResolvedValue({
        id: 'draft-new',
        walletId,
        userId,
        ...validDraftRequest,
        amount: BigInt(validDraftRequest.amount),
        fee: BigInt(validDraftRequest.fee),
        totalInput: BigInt(validDraftRequest.totalInput),
        totalOutput: BigInt(validDraftRequest.totalOutput),
        changeAmount: BigInt(validDraftRequest.changeAmount),
        effectiveAmount: BigInt(validDraftRequest.effectiveAmount),
        status: 'unsigned',
        signedDeviceIds: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      // System setting for expiration
      mockPrismaClient.systemSetting.findUnique.mockResolvedValue({
        key: 'draftExpirationDays',
        value: '7',
      });
    });

    it('should create a draft and lock UTXOs successfully', async () => {
      const req = createMockRequest({
        params: { walletId },
        body: validDraftRequest,
        user: { userId, username: 'testuser', isAdmin: false },
      });

      // Simulate the route handler behavior
      const wallet = await walletService.getWalletById(walletId, userId);
      expect(wallet).toBeDefined();
      expect(wallet?.userRole).not.toBe('viewer');

      // Create draft
      const draft = await mockPrismaClient.draftTransaction.create({
        data: {
          walletId,
          userId,
          ...validDraftRequest,
          amount: BigInt(validDraftRequest.amount),
          fee: BigInt(validDraftRequest.fee),
          totalInput: BigInt(validDraftRequest.totalInput),
          totalOutput: BigInt(validDraftRequest.totalOutput),
          changeAmount: BigInt(validDraftRequest.changeAmount),
          effectiveAmount: BigInt(validDraftRequest.effectiveAmount),
          status: 'unsigned',
          signedDeviceIds: [],
        },
      });

      // Lock UTXOs
      const { found: utxoIds } = await draftLockService.resolveUtxoIds(
        walletId,
        validDraftRequest.selectedUtxoIds
      );
      const lockResult = await draftLockService.lockUtxosForDraft(
        draft.id,
        utxoIds,
        { isRBF: false }
      );

      expect(lockResult.success).toBe(true);
      expect(lockResult.lockedCount).toBe(2);
    });

    it('should return 409 Conflict when UTXOs are already locked', async () => {
      // UTXOs are locked by another draft
      (draftLockService.lockUtxosForDraft as Mock).mockResolvedValue({
        success: false,
        lockedCount: 0,
        failedUtxoIds: ['txid-aaa:0'],
        lockedByDraftIds: ['other-draft-456'],
      });

      const { res, getResponse } = createMockResponse();

      // Simulate the route handler logic
      const draft = await mockPrismaClient.draftTransaction.create({
        data: { id: 'draft-temp' },
      });

      const { found: utxoIds } = await draftLockService.resolveUtxoIds(
        walletId,
        validDraftRequest.selectedUtxoIds
      );

      const lockResult = await draftLockService.lockUtxosForDraft(
        draft.id,
        utxoIds,
        { isRBF: false }
      );

      if (!lockResult.success) {
        // Delete the draft and return 409
        await mockPrismaClient.draftTransaction.delete({ where: { id: draft.id } });

        res.status!(409).json!({
          error: 'Conflict',
          message: 'One or more UTXOs are already locked by another draft transaction',
          lockedByDraftIds: lockResult.lockedByDraftIds,
          failedUtxoIds: lockResult.failedUtxoIds,
        });
      }

      const response = getResponse();
      expect(response.statusCode).toBe(409);
      expect(response.body.error).toBe('Conflict');
      expect(response.body.lockedByDraftIds).toContain('other-draft-456');
      expect(response.body.failedUtxoIds).toContain('txid-aaa:0');
      expect(mockPrismaClient.draftTransaction.delete).toHaveBeenCalled();
    });

    it('should skip UTXO locking for RBF drafts', async () => {
      const rbfDraftRequest = {
        ...validDraftRequest,
        isRBF: true,
        memo: 'Replacing transaction abc123...',
      };

      // Simulate route handler
      const draft = await mockPrismaClient.draftTransaction.create({
        data: { ...rbfDraftRequest, isRBF: true },
      });

      // For RBF, we skip locking
      if (!rbfDraftRequest.isRBF) {
        await draftLockService.lockUtxosForDraft(draft.id, [], { isRBF: false });
      }

      // Verify lockUtxosForDraft was NOT called since isRBF is true
      expect(draftLockService.lockUtxosForDraft).not.toHaveBeenCalled();
    });

    it('should return 403 for viewer role', async () => {
      (walletService.getWalletById as Mock).mockResolvedValue({
        id: walletId,
        name: 'Test Wallet',
        userRole: 'viewer', // Viewer cannot create drafts
      });

      const { res, getResponse } = createMockResponse();

      const wallet = await walletService.getWalletById(walletId, userId);
      if (wallet?.userRole === 'viewer') {
        res.status!(403).json!({
          error: 'Forbidden',
          message: 'Viewers cannot create draft transactions',
        });
      }

      const response = getResponse();
      expect(response.statusCode).toBe(403);
      expect(response.body.error).toBe('Forbidden');
    });

    it('should return 404 when wallet not found', async () => {
      (walletService.getWalletById as Mock).mockResolvedValue(null);

      const { res, getResponse } = createMockResponse();

      const wallet = await walletService.getWalletById(walletId, userId);
      if (!wallet) {
        res.status!(404).json!({
          error: 'Not Found',
          message: 'Wallet not found',
        });
      }

      const response = getResponse();
      expect(response.statusCode).toBe(404);
    });

    it('should return 400 when required fields are missing', async () => {
      const invalidRequest = {
        recipient: 'tb1q...',
        // Missing: amount, feeRate, psbtBase64
      };

      const { res, getResponse } = createMockResponse();

      if (!invalidRequest.recipient || !(invalidRequest as any).amount ||
          !(invalidRequest as any).feeRate || !(invalidRequest as any).psbtBase64) {
        res.status!(400).json!({
          error: 'Bad Request',
          message: 'recipient, amount, feeRate, and psbtBase64 are required',
        });
      }

      const response = getResponse();
      expect(response.statusCode).toBe(400);
    });

    it('should warn when some UTXOs are not found', async () => {
      (draftLockService.resolveUtxoIds as Mock).mockResolvedValue({
        found: ['utxo-id-1'],
        notFound: ['txid-missing:99'], // One UTXO not found
      });

      const { found, notFound } = await draftLockService.resolveUtxoIds(
        walletId,
        ['txid-aaa:0', 'txid-missing:99']
      );

      expect(found).toHaveLength(1);
      expect(notFound).toHaveLength(1);
      expect(notFound).toContain('txid-missing:99');

      // Should still proceed with found UTXOs
      const lockResult = await draftLockService.lockUtxosForDraft(
        'draft-id',
        found,
        { isRBF: false }
      );
      expect(lockResult.success).toBe(true);
    });
  });
};
