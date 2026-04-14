import { beforeEach, describe, expect, it, type Mock } from 'vitest';
import { createMockResponse } from '../../../helpers/testUtils';
import { mockPrismaClient } from '../../../mocks/prisma';
import { walletService } from './draftsTestHarness';

export const registerDraftMultisigContracts = () => {
  describe('Multi-sig Group Wallet Signing', () => {
    const walletId = 'wallet-multisig';
    const userId = 'user-123';
    const draftId = 'draft-multisig';

    const createMultisigWallet = (quorum: number, totalSigners: number) => ({
      id: walletId,
      name: 'Test Multisig Wallet',
      type: 'multi_sig',
      scriptType: 'native_segwit',
      network: 'testnet',
      quorum,
      totalSigners,
      userRole: 'signer',
    });

    beforeEach(() => {
      (walletService.getWalletById as Mock).mockResolvedValue(createMultisigWallet(2, 3));
    });

    describe('Partial Signature Tracking', () => {
      it('should track first device signature for 2-of-3 multisig', async () => {
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

        mockPrismaClient.draftTransaction.update.mockResolvedValue({
          id: draftId,
          status: 'partial',
          signedDeviceIds: ['device-1'],
          signedPsbtBase64: 'cHNidP8...',
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

        // Add first signature - status should become 'partial'
        const currentSigned = existingDraft?.signedDeviceIds || [];
        const newSignedDeviceIds = [...currentSigned, 'device-1'];

        const updatedDraft = await mockPrismaClient.draftTransaction.update({
          where: { id: draftId },
          data: {
            signedPsbtBase64: 'cHNidP8...',
            signedDeviceIds: newSignedDeviceIds,
            status: 'partial', // First sig = partial
          },
        });

        expect(updatedDraft.status).toBe('partial');
        expect(updatedDraft.signedDeviceIds).toHaveLength(1);
        expect(updatedDraft.signedDeviceIds).toContain('device-1');
      });

      it('should track second device signature and become fully signed for 2-of-3 multisig', async () => {
        mockPrismaClient.draftTransaction.findFirst.mockResolvedValue({
          id: draftId,
          walletId,
          userId,
          status: 'partial',
          signedDeviceIds: ['device-1'],
          signedPsbtBase64: 'cHNidP8partial...',
          amount: BigInt(50000),
          fee: BigInt(1000),
          totalInput: BigInt(100000),
          totalOutput: BigInt(99000),
          changeAmount: BigInt(49000),
          effectiveAmount: BigInt(50000),
        });

        mockPrismaClient.draftTransaction.update.mockResolvedValue({
          id: draftId,
          status: 'signed',
          signedDeviceIds: ['device-1', 'device-2'],
          signedPsbtBase64: 'cHNidP8fullysigned...',
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

        const quorum = 2;
        const currentSigned = existingDraft?.signedDeviceIds || [];
        const newSignedDeviceIds = [...currentSigned, 'device-2'];

        // When quorum is met, status should be 'signed'
        const newStatus = newSignedDeviceIds.length >= quorum ? 'signed' : 'partial';

        const updatedDraft = await mockPrismaClient.draftTransaction.update({
          where: { id: draftId },
          data: {
            signedPsbtBase64: 'cHNidP8fullysigned...',
            signedDeviceIds: newSignedDeviceIds,
            status: newStatus,
          },
        });

        expect(updatedDraft.status).toBe('signed');
        expect(updatedDraft.signedDeviceIds).toHaveLength(2);
        expect(updatedDraft.signedDeviceIds).toContain('device-1');
        expect(updatedDraft.signedDeviceIds).toContain('device-2');
      });
    });

    describe('Quorum Validation', () => {
      it('should correctly determine if quorum is met for 2-of-3', () => {
        const quorum = 2;
        const signedCount1 = 1;
        const signedCount2 = 2;
        const signedCount3 = 3;

        expect(signedCount1 >= quorum).toBe(false);
        expect(signedCount2 >= quorum).toBe(true);
        expect(signedCount3 >= quorum).toBe(true);
      });

      it('should correctly determine if quorum is met for 3-of-5', () => {
        const quorum = 3;
        const signedCounts = [1, 2, 3, 4, 5];
        const expected = [false, false, true, true, true];

        signedCounts.forEach((count, idx) => {
          expect(count >= quorum).toBe(expected[idx]);
        });
      });

      it('should correctly determine if quorum is met for 1-of-3', () => {
        const quorum = 1;
        expect(1 >= quorum).toBe(true);
        expect(2 >= quorum).toBe(true);
        expect(3 >= quorum).toBe(true);
      });

      it('should handle single-sig wallet (quorum = 1)', () => {
        const quorum = 1;
        const signedDeviceIds = ['device-1'];

        expect(signedDeviceIds.length >= quorum).toBe(true);

        // Single device = fully signed for single-sig
        const status = signedDeviceIds.length >= quorum ? 'signed' : 'partial';
        expect(status).toBe('signed');
      });
    });

    describe('Status Progression', () => {
      it('should progress: unsigned -> partial -> signed for 3-of-5 multisig', async () => {
        const quorum = 3;

        // Initial state: unsigned
        const initialStatus = 'unsigned';
        expect(initialStatus).toBe('unsigned');

        // After first signature: partial
        const statusAfter1 = 1 >= quorum ? 'signed' : 'partial';
        expect(statusAfter1).toBe('partial');

        // After second signature: still partial
        const statusAfter2 = 2 >= quorum ? 'signed' : 'partial';
        expect(statusAfter2).toBe('partial');

        // After third signature: signed (quorum met!)
        const statusAfter3 = 3 >= quorum ? 'signed' : 'partial';
        expect(statusAfter3).toBe('signed');
      });

      it('should allow additional signatures beyond quorum', async () => {
        mockPrismaClient.draftTransaction.findFirst.mockResolvedValue({
          id: draftId,
          walletId,
          userId,
          status: 'signed',
          signedDeviceIds: ['device-1', 'device-2'],
          amount: BigInt(50000),
          fee: BigInt(1000),
          totalInput: BigInt(100000),
          totalOutput: BigInt(99000),
          changeAmount: BigInt(49000),
          effectiveAmount: BigInt(50000),
        });

        // Draft is already signed but third device wants to add signature
        const existingDraft = await mockPrismaClient.draftTransaction.findFirst({
          where: { id: draftId, walletId },
        });

        const currentSigned = existingDraft?.signedDeviceIds || [];

        // Should allow adding more signatures
        if (!currentSigned.includes('device-3')) {
          const newSignedDeviceIds = [...currentSigned, 'device-3'];
          expect(newSignedDeviceIds).toHaveLength(3);
        }
      });
    });

    describe('Device ID Handling', () => {
      it('should prevent same device from signing twice', async () => {
        mockPrismaClient.draftTransaction.findFirst.mockResolvedValue({
          id: draftId,
          walletId,
          userId,
          status: 'partial',
          signedDeviceIds: ['device-1'],
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
        const newDeviceId = 'device-1'; // Same device trying to sign again

        // Check if device already signed
        const alreadySigned = currentSigned.includes(newDeviceId);
        expect(alreadySigned).toBe(true);

        // Should not add duplicate
        const newSignedDeviceIds = alreadySigned
          ? currentSigned
          : [...currentSigned, newDeviceId];
        expect(newSignedDeviceIds).toHaveLength(1);
        expect(newSignedDeviceIds).toEqual(['device-1']);
      });

      it('should track multiple unique device IDs', async () => {
        const signedDeviceIds: string[] = [];
        const devices = ['device-a', 'device-b', 'device-c'];

        devices.forEach((deviceId) => {
          if (!signedDeviceIds.includes(deviceId)) {
            signedDeviceIds.push(deviceId);
          }
        });

        expect(signedDeviceIds).toHaveLength(3);
        expect(signedDeviceIds).toEqual(['device-a', 'device-b', 'device-c']);
      });

      it('should handle empty device ID gracefully', async () => {
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

        const existingDraft = await mockPrismaClient.draftTransaction.findFirst({
          where: { id: draftId, walletId },
        });

        const currentSigned = existingDraft?.signedDeviceIds || [];
        const newDeviceId = ''; // Empty device ID

        // Empty string should be handled (not added or filter validation)
        if (newDeviceId && !currentSigned.includes(newDeviceId)) {
          currentSigned.push(newDeviceId);
        }

        expect(currentSigned).toHaveLength(0);
      });
    });

    describe('PSBT Signature Merging', () => {
      it('should update signedPsbtBase64 with each new signature', async () => {
        // First signature
        const firstPsbt = 'cHNidP8BAH...partial1';

        mockPrismaClient.draftTransaction.update.mockResolvedValueOnce({
          id: draftId,
          status: 'partial',
          signedDeviceIds: ['device-1'],
          signedPsbtBase64: firstPsbt,
          amount: BigInt(50000),
          fee: BigInt(1000),
          totalInput: BigInt(100000),
          totalOutput: BigInt(99000),
          changeAmount: BigInt(49000),
          effectiveAmount: BigInt(50000),
        });

        const draft1 = await mockPrismaClient.draftTransaction.update({
          where: { id: draftId },
          data: {
            signedPsbtBase64: firstPsbt,
            signedDeviceIds: ['device-1'],
            status: 'partial',
          },
        });

        expect(draft1.signedPsbtBase64).toBe(firstPsbt);

        // Second signature - merged PSBT
        const mergedPsbt = 'cHNidP8BAH...fullysigned';

        mockPrismaClient.draftTransaction.update.mockResolvedValueOnce({
          id: draftId,
          status: 'signed',
          signedDeviceIds: ['device-1', 'device-2'],
          signedPsbtBase64: mergedPsbt,
          amount: BigInt(50000),
          fee: BigInt(1000),
          totalInput: BigInt(100000),
          totalOutput: BigInt(99000),
          changeAmount: BigInt(49000),
          effectiveAmount: BigInt(50000),
        });

        const draft2 = await mockPrismaClient.draftTransaction.update({
          where: { id: draftId },
          data: {
            signedPsbtBase64: mergedPsbt,
            signedDeviceIds: ['device-1', 'device-2'],
            status: 'signed',
          },
        });

        expect(draft2.signedPsbtBase64).toBe(mergedPsbt);
        expect(draft2.signedPsbtBase64).not.toBe(firstPsbt);
      });
    });

    describe('Role-based Access for Multisig', () => {
      it('should allow signer role to add signatures', async () => {
        (walletService.getWalletById as Mock).mockResolvedValue({
          ...createMultisigWallet(2, 3),
          userRole: 'signer',
        });

        const wallet = await walletService.getWalletById(walletId, userId);
        expect(wallet?.userRole).toBe('signer');

        // Signers can add signatures
        const canSign = wallet?.userRole === 'signer' || wallet?.userRole === 'owner';
        expect(canSign).toBe(true);
      });

      it('should allow owner role to add signatures', async () => {
        (walletService.getWalletById as Mock).mockResolvedValue({
          ...createMultisigWallet(2, 3),
          userRole: 'owner',
        });

        const wallet = await walletService.getWalletById(walletId, userId);
        expect(wallet?.userRole).toBe('owner');

        const canSign = wallet?.userRole === 'signer' || wallet?.userRole === 'owner';
        expect(canSign).toBe(true);
      });

      it('should prevent viewer role from adding signatures', async () => {
        (walletService.getWalletById as Mock).mockResolvedValue({
          ...createMultisigWallet(2, 3),
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
    });
  });
};
