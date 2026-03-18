import { vi, Mock } from 'vitest';
/**
 * Draft Service Tests
 *
 * Tests for draft transaction management including CRUD operations
 * and UTXO locking.
 */

// Mock dependencies before imports
vi.mock('../../../src/models/prisma', () => ({
  __esModule: true,
  default: {
    systemSetting: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock('../../../src/repositories', () => ({
  draftRepository: {
    findByWalletId: vi.fn(),
    findByIdInWallet: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    deleteExpired: vi.fn(),
  },
  DraftStatus: {
    UNSIGNED: 'unsigned',
    PARTIAL: 'partial',
    SIGNED: 'signed',
  },
}));

vi.mock('../../../src/services/accessControl', () => ({
  requireWalletAccess: vi.fn(),
  checkWalletAccess: vi.fn(),
}));

vi.mock('../../../src/services/draftLockService', () => ({
  lockUtxosForDraft: vi.fn(),
  resolveUtxoIds: vi.fn(),
}));

vi.mock('../../../src/services/notifications/notificationService', () => ({
  notifyNewDraft: vi.fn(),
}));

vi.mock('../../../src/services/wallet', () => ({
  getWalletById: vi.fn(),
}));

vi.mock('../../../src/services/vaultPolicy/approvalService', () => ({
  approvalService: {
    createApprovalRequestsForDraft: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('../../../src/constants', () => ({
  DEFAULT_DRAFT_EXPIRATION_DAYS: 7,
}));

import prisma from '../../../src/models/prisma';
import { draftRepository } from '../../../src/repositories';
import { lockUtxosForDraft, resolveUtxoIds } from '../../../src/services/draftLockService';
import { notifyNewDraft } from '../../../src/services/notifications/notificationService';
import * as walletService from '../../../src/services/wallet';
import * as bitcoin from 'bitcoinjs-lib';
import { NotFoundError, ForbiddenError, InvalidInputError, ConflictError, WalletNotFoundError } from '../../../src/errors';
import {
  getDraftsForWallet,
  getDraft,
  createDraft,
  updateDraft,
  deleteDraft,
  deleteExpiredDrafts,
} from '../../../src/services/draftService';

describe('DraftService', () => {
  const userId = 'user-123';
  const walletId = 'wallet-456';
  const draftId = 'draft-789';

  const mockWallet = {
    id: walletId,
    name: 'Test Wallet',
    userRole: 'owner',
  };

  const mockDraft = {
    id: draftId,
    walletId,
    userId,
    recipient: 'tb1qtest...',
    amount: BigInt(100000),
    feeRate: 5,
    psbtBase64: 'cHNidP8...',
    status: 'unsigned',
    signedDeviceIds: [],
    selectedUtxoIds: ['utxo-1', 'utxo-2'],
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (walletService.getWalletById as Mock).mockResolvedValue(mockWallet);
    (notifyNewDraft as Mock).mockResolvedValue(undefined);
  });

  describe('getDraftsForWallet', () => {
    it('should return drafts for a wallet', async () => {
      const mockDrafts = [mockDraft, { ...mockDraft, id: 'draft-2' }];
      (draftRepository.findByWalletId as Mock).mockResolvedValue(mockDrafts);

      const result = await getDraftsForWallet(walletId, userId);

      expect(walletService.getWalletById).toHaveBeenCalledWith(walletId, userId);
      expect(result).toEqual(mockDrafts);
    });

    it('should throw NotFoundError if wallet not found', async () => {
      (walletService.getWalletById as Mock).mockResolvedValue(null);

      await expect(getDraftsForWallet(walletId, userId)).rejects.toThrow(NotFoundError);
    });
  });

  describe('getDraft', () => {
    it('should return a specific draft', async () => {
      (draftRepository.findByIdInWallet as Mock).mockResolvedValue(mockDraft);

      const result = await getDraft(walletId, draftId, userId);

      expect(result).toEqual(mockDraft);
    });

    it('should throw NotFoundError if wallet not found', async () => {
      (walletService.getWalletById as Mock).mockResolvedValue(null);

      await expect(getDraft(walletId, draftId, userId)).rejects.toThrow(NotFoundError);
    });

    it('should throw NotFoundError if draft not found', async () => {
      (draftRepository.findByIdInWallet as Mock).mockResolvedValue(null);

      await expect(getDraft(walletId, draftId, userId)).rejects.toThrow(NotFoundError);
    });
  });

  describe('createDraft', () => {
    const validInput = {
      recipient: 'tb1qtest...',
      amount: 100000,
      feeRate: 5,
      psbtBase64: 'cHNidP8...',
      selectedUtxoIds: ['utxo-1'],
    };

    beforeEach(() => {
      (draftRepository.create as Mock).mockResolvedValue(mockDraft);
      (resolveUtxoIds as Mock).mockResolvedValue({ found: ['utxo-id-1'], notFound: [] });
      (lockUtxosForDraft as Mock).mockResolvedValue({ success: true, lockedCount: 1 });
      (prisma.systemSetting.findUnique as Mock).mockResolvedValue(null);
    });

    it('should create a draft with valid input', async () => {
      const result = await createDraft(walletId, userId, validInput);

      expect(draftRepository.create).toHaveBeenCalled();
      expect(result).toEqual(mockDraft);
    });

    it('should lock UTXOs when selectedUtxoIds provided', async () => {
      await createDraft(walletId, userId, validInput);

      expect(resolveUtxoIds).toHaveBeenCalledWith(walletId, validInput.selectedUtxoIds);
      expect(lockUtxosForDraft).toHaveBeenCalled();
    });

    it('uses empty selectedUtxoIds default when none are provided', async () => {
      await createDraft(walletId, userId, {
        recipient: validInput.recipient,
        amount: validInput.amount,
        feeRate: validInput.feeRate,
        psbtBase64: validInput.psbtBase64,
      });

      expect(draftRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          selectedUtxoIds: [],
        })
      );
      expect(resolveUtxoIds).not.toHaveBeenCalled();
      expect(lockUtxosForDraft).not.toHaveBeenCalled();
    });

    it('should not lock UTXOs for RBF transactions', async () => {
      await createDraft(walletId, userId, { ...validInput, isRBF: true });

      expect(lockUtxosForDraft).not.toHaveBeenCalled();
    });

    it('should throw ForbiddenError for viewers', async () => {
      (walletService.getWalletById as Mock).mockResolvedValue({ ...mockWallet, userRole: 'viewer' });

      await expect(createDraft(walletId, userId, validInput)).rejects.toThrow(ForbiddenError);
    });

    it('throws WalletNotFoundError when wallet does not exist', async () => {
      (walletService.getWalletById as Mock).mockResolvedValue(null);
      await expect(createDraft(walletId, userId, validInput)).rejects.toThrow(WalletNotFoundError);
    });

    it('should throw InvalidInputError for missing required fields', async () => {
      await expect(createDraft(walletId, userId, { ...validInput, recipient: '' })).rejects.toThrow(InvalidInputError);
      await expect(createDraft(walletId, userId, { ...validInput, psbtBase64: '' })).rejects.toThrow(InvalidInputError);
    });

    it('should throw ConflictError when UTXOs are already locked', async () => {
      (lockUtxosForDraft as Mock).mockResolvedValue({ success: false });

      await expect(createDraft(walletId, userId, validInput)).rejects.toThrow(ConflictError);
      expect(draftRepository.remove).toHaveBeenCalledWith(mockDraft.id);
    });

    it('continues when some selected UTXOs are not found', async () => {
      (resolveUtxoIds as Mock).mockResolvedValue({
        found: ['utxo-id-1'],
        notFound: ['missing-utxo'],
      });

      await expect(createDraft(walletId, userId, validInput)).resolves.toEqual(mockDraft);
      expect(lockUtxosForDraft).toHaveBeenCalledWith(mockDraft.id, ['utxo-id-1'], { isRBF: false });
    });

    it('skips lock call when selected UTXOs resolve to an empty set', async () => {
      (resolveUtxoIds as Mock).mockResolvedValue({
        found: [],
        notFound: ['missing-utxo'],
      });

      await expect(createDraft(walletId, userId, validInput)).resolves.toEqual(mockDraft);
      expect(lockUtxosForDraft).not.toHaveBeenCalled();
    });

    it('should send notification after creating draft', async () => {
      await createDraft(walletId, userId, validInput);

      expect(notifyNewDraft).toHaveBeenCalledWith(
        walletId,
        expect.objectContaining({ id: mockDraft.id }),
        userId
      );
    });

    it('swallows notification errors and still returns draft', async () => {
      (notifyNewDraft as Mock).mockRejectedValueOnce(new Error('notify failed'));

      const result = await createDraft(walletId, userId, validInput);
      await Promise.resolve();

      expect(result).toEqual(mockDraft);
      expect(notifyNewDraft).toHaveBeenCalled();
    });

    it('should use custom expiration days from settings', async () => {
      (prisma.systemSetting.findUnique as Mock).mockResolvedValue({ value: '14' });

      await createDraft(walletId, userId, validInput);

      expect(draftRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          expiresAt: expect.any(Date),
        })
      );
    });

    it('should allow signers to create drafts', async () => {
      (walletService.getWalletById as Mock).mockResolvedValue({ ...mockWallet, userRole: 'signer' });

      const result = await createDraft(walletId, userId, validInput);

      expect(result).toEqual(mockDraft);
    });

    it('creates approval requests when policy evaluation has approval_required triggers', async () => {
      const { approvalService } = await import('../../../src/services/vaultPolicy/approvalService');

      const policyEvaluation = {
        allowed: true,
        triggered: [
          { policyId: 'p1', policyName: 'Large TX', type: 'spending_limit' as const, action: 'approval_required' as const, reason: 'Over threshold' },
        ],
      };

      const result = await createDraft(walletId, userId, { ...validInput, policyEvaluation });

      expect(approvalService.createApprovalRequestsForDraft).toHaveBeenCalledWith(
        mockDraft.id,
        walletId,
        userId,
        policyEvaluation.triggered
      );
      expect(result).toEqual(mockDraft);
    });

    it('swallows errors from approval request creation and still returns draft', async () => {
      const { approvalService } = await import('../../../src/services/vaultPolicy/approvalService');
      (approvalService.createApprovalRequestsForDraft as Mock).mockRejectedValueOnce(
        new Error('approval service down')
      );

      const policyEvaluation = {
        allowed: true,
        triggered: [
          { policyId: 'p1', policyName: 'Limit', type: 'spending_limit' as const, action: 'approval_required' as const, reason: 'Exceeded' },
        ],
      };

      const result = await createDraft(walletId, userId, { ...validInput, policyEvaluation });

      expect(approvalService.createApprovalRequestsForDraft).toHaveBeenCalled();
      expect(result).toEqual(mockDraft);
    });

    it('does not create approval requests when no triggers have approval_required action', async () => {
      const { approvalService } = await import('../../../src/services/vaultPolicy/approvalService');

      const policyEvaluation = {
        allowed: true,
        triggered: [
          { policyId: 'p1', policyName: 'Alert', type: 'spending_limit' as const, action: 'blocked' as const, reason: 'Info only' },
        ],
      };

      await createDraft(walletId, userId, { ...validInput, policyEvaluation });

      expect(approvalService.createApprovalRequestsForDraft).not.toHaveBeenCalled();
    });
  });

  describe('updateDraft', () => {
    beforeEach(() => {
      (draftRepository.findByIdInWallet as Mock).mockResolvedValue(mockDraft);
      (draftRepository.update as Mock).mockResolvedValue({ ...mockDraft, status: 'partial' });
    });

    it('should update draft status', async () => {
      const result = await updateDraft(walletId, draftId, userId, { status: 'partial' });

      expect(draftRepository.update).toHaveBeenCalledWith(draftId, { status: 'partial' });
      expect(result.status).toBe('partial');
    });

    it('should add signed device ID', async () => {
      await updateDraft(walletId, draftId, userId, { signedDeviceId: 'device-1' });

      expect(draftRepository.update).toHaveBeenCalledWith(draftId, expect.objectContaining({
        signedDeviceIds: ['device-1'],
      }));
    });

    it('uses empty signed-device list when draft has no signedDeviceIds yet', async () => {
      (draftRepository.findByIdInWallet as Mock).mockResolvedValue({
        ...mockDraft,
        signedDeviceIds: undefined,
      });

      await updateDraft(walletId, draftId, userId, { signedDeviceId: 'device-first' });

      expect(draftRepository.update).toHaveBeenCalledWith(
        draftId,
        expect.objectContaining({
          signedDeviceIds: ['device-first'],
        })
      );
    });

    it('should not duplicate signed device IDs', async () => {
      (draftRepository.findByIdInWallet as Mock).mockResolvedValue({
        ...mockDraft,
        signedDeviceIds: ['device-1'],
      });

      await updateDraft(walletId, draftId, userId, { signedDeviceId: 'device-1' });

      expect(draftRepository.update).toHaveBeenCalledWith(draftId, expect.not.objectContaining({
        signedDeviceIds: expect.anything(),
      }));
    });

    it('should throw ForbiddenError for viewers', async () => {
      (walletService.getWalletById as Mock).mockResolvedValue({ ...mockWallet, userRole: 'viewer' });

      await expect(updateDraft(walletId, draftId, userId, { status: 'signed' })).rejects.toThrow(ForbiddenError);
    });

    it('should throw NotFoundError if draft not found', async () => {
      (draftRepository.findByIdInWallet as Mock).mockResolvedValue(null);

      await expect(updateDraft(walletId, draftId, userId, {})).rejects.toThrow(NotFoundError);
    });

    it('should throw InvalidInputError for invalid status', async () => {
      await expect(updateDraft(walletId, draftId, userId, { status: 'invalid' as any })).rejects.toThrow(InvalidInputError);
    });

    it('should update label and memo', async () => {
      await updateDraft(walletId, draftId, userId, { label: 'Test', memo: 'Note' });

      expect(draftRepository.update).toHaveBeenCalledWith(draftId, expect.objectContaining({
        label: 'Test',
        memo: 'Note',
      }));
    });

    it('throws WalletNotFoundError when wallet is missing', async () => {
      (walletService.getWalletById as Mock).mockResolvedValue(null);
      await expect(updateDraft(walletId, draftId, userId, {})).rejects.toThrow(WalletNotFoundError);
    });

    it('combines existing and new PSBT signatures when signedPsbtBase64 is provided', async () => {
      const existingPsbtObj = {
        data: {
          inputs: [
            {
              partialSig: [
                { pubkey: Buffer.from('aa'.repeat(16), 'hex') },
              ],
            },
          ],
        },
        combine: vi.fn(),
        toBase64: vi.fn().mockReturnValue('combined-psbt'),
      };
      const newPsbtObj = {
        data: {
          inputs: [
            {
              partialSig: [
                { pubkey: Buffer.from('bb'.repeat(16), 'hex') },
              ],
            },
          ],
        },
      };

      const fromBase64Spy = vi.spyOn(bitcoin.Psbt, 'fromBase64');
      fromBase64Spy
        .mockReturnValueOnce(existingPsbtObj as any)
        .mockReturnValueOnce(newPsbtObj as any);

      await updateDraft(walletId, draftId, userId, { signedPsbtBase64: 'new-psbt' });

      expect(existingPsbtObj.combine).toHaveBeenCalledWith(newPsbtObj);
      expect(draftRepository.update).toHaveBeenCalledWith(
        draftId,
        expect.objectContaining({
          signedPsbtBase64: 'combined-psbt',
          expectedUpdatedAt: mockDraft.updatedAt,
        })
      );
      fromBase64Spy.mockRestore();
    });

    it('handles signed PSBT sources and inputs without partial signatures', async () => {
      (draftRepository.findByIdInWallet as Mock).mockResolvedValue({
        ...mockDraft,
        signedPsbtBase64: 'existing-signed-psbt',
      });
      const existingPsbtObj = {
        data: {
          inputs: [{}],
        },
        combine: vi.fn(),
        toBase64: vi.fn().mockReturnValue('combined-no-partials'),
      };
      const newPsbtObj = {
        data: {
          inputs: [{}],
        },
      };

      const fromBase64Spy = vi.spyOn(bitcoin.Psbt, 'fromBase64');
      fromBase64Spy
        .mockReturnValueOnce(existingPsbtObj as any)
        .mockReturnValueOnce(newPsbtObj as any);

      await updateDraft(walletId, draftId, userId, { signedPsbtBase64: 'new-psbt-no-partials' });

      expect(draftRepository.update).toHaveBeenCalledWith(
        draftId,
        expect.objectContaining({
          signedPsbtBase64: 'combined-no-partials',
        })
      );
      fromBase64Spy.mockRestore();
    });

    it('falls back to new PSBT when combine fails', async () => {
      const existingPsbtObj = {
        data: { inputs: [] },
        combine: vi.fn(() => {
          throw new Error('combine failed');
        }),
      };
      const newPsbtObj = {
        data: { inputs: [] },
      };
      const fromBase64Spy = vi.spyOn(bitcoin.Psbt, 'fromBase64');
      fromBase64Spy
        .mockReturnValueOnce(existingPsbtObj as any)
        .mockReturnValueOnce(newPsbtObj as any);

      await updateDraft(walletId, draftId, userId, { signedPsbtBase64: 'fallback-psbt' });

      expect(draftRepository.update).toHaveBeenCalledWith(
        draftId,
        expect.objectContaining({
          signedPsbtBase64: 'fallback-psbt',
        })
      );
      fromBase64Spy.mockRestore();
    });

    it('retries on optimistic conflict and succeeds with refreshed draft', async () => {
      const refreshedDraft = {
        ...mockDraft,
        updatedAt: new Date(mockDraft.updatedAt.getTime() + 1000),
      };
      (draftRepository.update as Mock)
        .mockRejectedValueOnce(new Error('DRAFT_UPDATE_CONFLICT'))
        .mockResolvedValueOnce({ ...mockDraft, status: 'partial' });
      (draftRepository.findByIdInWallet as Mock)
        .mockResolvedValueOnce(mockDraft)
        .mockResolvedValueOnce(refreshedDraft);

      const result = await updateDraft(walletId, draftId, userId, {
        signedDeviceId: 'device-retry',
      });

      expect(result.status).toBe('partial');
      expect(draftRepository.update).toHaveBeenNthCalledWith(
        1,
        draftId,
        expect.objectContaining({
          signedDeviceIds: ['device-retry'],
          expectedUpdatedAt: mockDraft.updatedAt,
        })
      );
      expect(draftRepository.update).toHaveBeenNthCalledWith(
        2,
        draftId,
        expect.objectContaining({
          signedDeviceIds: ['device-retry'],
          expectedUpdatedAt: refreshedDraft.updatedAt,
        })
      );
    });

    it('throws ConflictError after exhausting optimistic retries', async () => {
      (draftRepository.update as Mock).mockRejectedValue(new Error('DRAFT_UPDATE_CONFLICT'));
      (draftRepository.findByIdInWallet as Mock).mockResolvedValue(mockDraft);

      await expect(
        updateDraft(walletId, draftId, userId, { signedDeviceId: 'device-fail' })
      ).rejects.toThrow(ConflictError);
    });

    it('throws NotFoundError if draft disappears during conflict retry', async () => {
      (draftRepository.update as Mock).mockRejectedValueOnce(new Error('DRAFT_UPDATE_CONFLICT'));
      (draftRepository.findByIdInWallet as Mock)
        .mockResolvedValueOnce(mockDraft)
        .mockResolvedValueOnce(null);

      await expect(
        updateDraft(walletId, draftId, userId, { signedDeviceId: 'device-missing' })
      ).rejects.toThrow(NotFoundError);
    });

    it('rethrows non-conflict update errors without retry', async () => {
      (draftRepository.update as Mock).mockRejectedValueOnce(new Error('db down'));
      await expect(
        updateDraft(walletId, draftId, userId, { signedDeviceId: 'device-err' })
      ).rejects.toThrow('db down');
    });
  });

  describe('deleteDraft', () => {
    beforeEach(() => {
      (draftRepository.findByIdInWallet as Mock).mockResolvedValue(mockDraft);
      (draftRepository.remove as Mock).mockResolvedValue(undefined);
    });

    it('should delete draft as creator', async () => {
      await deleteDraft(walletId, draftId, userId);

      expect(draftRepository.remove).toHaveBeenCalledWith(draftId);
    });

    it('should delete draft as wallet owner', async () => {
      const differentUser = 'other-user';
      (draftRepository.findByIdInWallet as Mock).mockResolvedValue({
        ...mockDraft,
        userId: 'original-creator',
      });

      await deleteDraft(walletId, draftId, differentUser);

      expect(draftRepository.remove).toHaveBeenCalledWith(draftId);
    });

    it('should throw ForbiddenError if not creator or owner', async () => {
      (draftRepository.findByIdInWallet as Mock).mockResolvedValue({
        ...mockDraft,
        userId: 'original-creator',
      });
      (walletService.getWalletById as Mock).mockResolvedValue({ ...mockWallet, userRole: 'signer' });

      await expect(deleteDraft(walletId, draftId, 'other-user')).rejects.toThrow(ForbiddenError);
    });

    it('should throw NotFoundError if wallet not found', async () => {
      (walletService.getWalletById as Mock).mockResolvedValue(null);

      await expect(deleteDraft(walletId, draftId, userId)).rejects.toThrow(NotFoundError);
    });

    it('should throw NotFoundError if draft not found', async () => {
      (draftRepository.findByIdInWallet as Mock).mockResolvedValue(null);

      await expect(deleteDraft(walletId, draftId, userId)).rejects.toThrow(NotFoundError);
    });
  });

  describe('deleteExpiredDrafts', () => {
    it('should delete expired drafts and return count', async () => {
      (draftRepository.deleteExpired as Mock).mockResolvedValue(5);

      const result = await deleteExpiredDrafts();

      expect(draftRepository.deleteExpired).toHaveBeenCalled();
      expect(result).toBe(5);
    });

    it('should return 0 when no expired drafts', async () => {
      (draftRepository.deleteExpired as Mock).mockResolvedValue(0);

      const result = await deleteExpiredDrafts();

      expect(result).toBe(0);
    });
  });
});
