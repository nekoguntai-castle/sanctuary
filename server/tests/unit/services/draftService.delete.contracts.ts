import { beforeEach, describe, expect, it, type Mock } from 'vitest';
import { ConflictError, ForbiddenError, NotFoundError } from '../../../src/errors';

type DraftRepositoryMocks = {
  deleteExpired: Mock;
  findByIdInWallet: Mock;
  removeActionable: Mock;
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
      draftRepository.removeActionable.mockResolvedValue(true);
    });

    it('should delete draft as creator', async () => {
      await deleteDraft(walletId, draftId, userId, 'signer');

      expect(draftRepository.removeActionable).toHaveBeenCalledWith(draftId, walletId);
    });

    it('should delete draft as wallet owner', async () => {
      const differentUser = 'other-user';
      draftRepository.findByIdInWallet.mockResolvedValue({
        ...mockDraft,
        userId: 'original-creator',
      });

      await deleteDraft(walletId, draftId, differentUser, 'owner');

      expect(draftRepository.removeActionable).toHaveBeenCalledWith(draftId, walletId);
    });

    // A broadcasted agent funding draft still counts toward the agent's daily/weekly cap.
    it.each([
      ['its creator', userId, 'signer'],
      ['the wallet owner', 'other-user', 'owner'],
    ])('refuses to delete a broadcasted draft for %s with 409 draft_retained', async (_who, caller, role) => {
      draftRepository.findByIdInWallet.mockResolvedValue({ ...mockDraft, status: 'broadcasted' });
      draftRepository.removeActionable.mockResolvedValue(false);

      await expect(deleteDraft(walletId, draftId, caller, role)).rejects.toMatchObject({
        statusCode: 409,
        details: { reason: 'draft_retained' },
      });
      expect(draftRepository.removeActionable).toHaveBeenCalledWith(draftId, walletId);
    });

    it('refuses with 409 when a broadcast archives the draft between the read and the delete', async () => {
      draftRepository.removeActionable.mockResolvedValue(false);

      await expect(deleteDraft(walletId, draftId, userId, 'owner')).rejects.toThrow(ConflictError);
      expect(draftRepository.findByIdInWallet).toHaveBeenCalledTimes(2);
    });

    it('reports 404 when a concurrent delete removed the draft between the read and the delete', async () => {
      draftRepository.findByIdInWallet.mockResolvedValueOnce(mockDraft).mockResolvedValue(null);
      draftRepository.removeActionable.mockResolvedValue(false);

      await expect(deleteDraft(walletId, draftId, userId, 'owner')).rejects.toThrow(NotFoundError);
      expect(draftRepository.findByIdInWallet).toHaveBeenCalledTimes(2);
    });

    it('should throw ForbiddenError if not creator or owner', async () => {
      draftRepository.findByIdInWallet.mockResolvedValue({
        ...mockDraft,
        userId: 'original-creator',
      });

      await expect(deleteDraft(walletId, draftId, 'other-user', 'signer')).rejects.toThrow(
        ForbiddenError
      );
      expect(draftRepository.removeActionable).not.toHaveBeenCalled();
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
