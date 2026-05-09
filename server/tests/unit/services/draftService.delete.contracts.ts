import { beforeEach, describe, expect, it, type Mock } from 'vitest';
import { ForbiddenError, NotFoundError } from '../../../src/errors';

type DraftRepositoryMocks = {
  deleteExpired: Mock;
  findByIdInWallet: Mock;
  remove: Mock;
};

type DraftDeletionContext = {
  deleteDraft: (
    walletId: string,
    draftId: string,
    userId: string,
    walletRole: string | null | undefined
  ) => Promise<void>;
  deleteExpiredDrafts: () => Promise<number>;
  draftId: string;
  draftRepository: DraftRepositoryMocks;
  mockDraft: Record<string, unknown> & { userId: string };
  userId: string;
  walletId: string;
};

export function registerDraftDeletionTests({
  deleteDraft,
  deleteExpiredDrafts,
  draftId,
  draftRepository,
  mockDraft,
  userId,
  walletId,
}: DraftDeletionContext): void {
  describe('deleteDraft', () => {
    beforeEach(() => {
      draftRepository.findByIdInWallet.mockResolvedValue(mockDraft);
      draftRepository.remove.mockResolvedValue(undefined);
    });

    it('should delete draft as creator', async () => {
      await deleteDraft(walletId, draftId, userId, 'signer');

      expect(draftRepository.remove).toHaveBeenCalledWith(draftId);
    });

    it('should delete draft as wallet owner', async () => {
      const differentUser = 'other-user';
      draftRepository.findByIdInWallet.mockResolvedValue({
        ...mockDraft,
        userId: 'original-creator',
      });

      await deleteDraft(walletId, draftId, differentUser, 'owner');

      expect(draftRepository.remove).toHaveBeenCalledWith(draftId);
    });

    it('should throw ForbiddenError if not creator or owner', async () => {
      draftRepository.findByIdInWallet.mockResolvedValue({
        ...mockDraft,
        userId: 'original-creator',
      });

      await expect(deleteDraft(walletId, draftId, 'other-user', 'signer')).rejects.toThrow(
        ForbiddenError
      );
    });

    it('should throw NotFoundError if draft not found', async () => {
      draftRepository.findByIdInWallet.mockResolvedValue(null);

      await expect(deleteDraft(walletId, draftId, userId, 'owner')).rejects.toThrow(
        NotFoundError
      );
    });
  });

  describe('deleteExpiredDrafts', () => {
    it('should delete expired drafts and return count', async () => {
      draftRepository.deleteExpired.mockResolvedValue(5);

      const result = await deleteExpiredDrafts();

      expect(draftRepository.deleteExpired).toHaveBeenCalled();
      expect(result).toBe(5);
    });

    it('should return 0 when no expired drafts', async () => {
      draftRepository.deleteExpired.mockResolvedValue(0);

      const result = await deleteExpiredDrafts();

      expect(result).toBe(0);
    });
  });
}
