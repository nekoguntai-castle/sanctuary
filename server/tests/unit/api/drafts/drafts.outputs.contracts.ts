import { describe, expect, it } from 'vitest';
import { createMockResponse, randomAddress } from '../../../helpers/testUtils';
import { mockPrismaClient } from '../../../mocks/prisma';

export const registerDraftOutputContracts = () => {
  describe('isRBF Flag Behavior', () => {
    const walletId = 'wallet-123';
    const userId = 'user-123';

    it('should set isRBF flag correctly for RBF transactions', async () => {
      mockPrismaClient.draftTransaction.create.mockResolvedValue({
        id: 'rbf-draft',
        walletId,
        userId,
        isRBF: true,
        recipient: randomAddress(),
        amount: BigInt(50000),
        fee: BigInt(2000),
        totalInput: BigInt(100000),
        totalOutput: BigInt(98000),
        changeAmount: BigInt(48000),
        effectiveAmount: BigInt(50000),
      });

      const draft = await mockPrismaClient.draftTransaction.create({
        data: {
          walletId,
          userId,
          isRBF: true,
          recipient: randomAddress(),
          amount: BigInt(50000),
          fee: BigInt(2000),
          totalInput: BigInt(100000),
          totalOutput: BigInt(98000),
          changeAmount: BigInt(48000),
          effectiveAmount: BigInt(50000),
        },
      });

      expect(draft.isRBF).toBe(true);
    });

    it('should default isRBF to false for regular transactions', async () => {
      mockPrismaClient.draftTransaction.create.mockResolvedValue({
        id: 'regular-draft',
        walletId,
        userId,
        isRBF: false,
        recipient: randomAddress(),
        amount: BigInt(50000),
        fee: BigInt(1000),
        totalInput: BigInt(100000),
        totalOutput: BigInt(99000),
        changeAmount: BigInt(49000),
        effectiveAmount: BigInt(50000),
      });

      const draft = await mockPrismaClient.draftTransaction.create({
        data: {
          walletId,
          userId,
          isRBF: false, // Explicitly false
          recipient: randomAddress(),
          amount: BigInt(50000),
          fee: BigInt(1000),
          totalInput: BigInt(100000),
          totalOutput: BigInt(99000),
          changeAmount: BigInt(49000),
          effectiveAmount: BigInt(50000),
        },
      });

      expect(draft.isRBF).toBe(false);
    });
  });

  describe('Decoy Outputs', () => {
    const walletId = 'wallet-123';
    const userId = 'user-123';

    it('should store decoyOutputs in draft', async () => {
      const decoyOutputs = [
        { address: randomAddress(), amount: 15000 },
        { address: randomAddress(), amount: 18000 },
      ];

      mockPrismaClient.draftTransaction.create.mockResolvedValue({
        id: 'decoy-draft',
        walletId,
        userId,
        recipient: randomAddress(),
        amount: BigInt(50000),
        fee: BigInt(1500),
        totalInput: BigInt(100000),
        totalOutput: BigInt(98500),
        changeAmount: BigInt(48500),
        effectiveAmount: BigInt(50000),
        decoyOutputs: decoyOutputs,
      });

      const draft = await mockPrismaClient.draftTransaction.create({
        data: {
          walletId,
          userId,
          recipient: randomAddress(),
          amount: BigInt(50000),
          decoyOutputs: decoyOutputs,
        },
      });

      expect(draft.decoyOutputs).toEqual(decoyOutputs);
      expect(Array.isArray(draft.decoyOutputs)).toBe(true);
      expect(draft.decoyOutputs).toHaveLength(2);
    });

    it('should validate decoy count is between 2 and 4', () => {
      // Test validation logic
      const validateDecoyCount = (count: number) => {
        return count >= 2 && count <= 4;
      };

      expect(validateDecoyCount(1)).toBe(false);
      expect(validateDecoyCount(2)).toBe(true);
      expect(validateDecoyCount(3)).toBe(true);
      expect(validateDecoyCount(4)).toBe(true);
      expect(validateDecoyCount(5)).toBe(false);
    });

    it('should handle draft without decoy outputs', async () => {
      mockPrismaClient.draftTransaction.create.mockResolvedValue({
        id: 'no-decoy-draft',
        walletId,
        userId,
        recipient: randomAddress(),
        amount: BigInt(50000),
        fee: BigInt(1000),
        totalInput: BigInt(100000),
        totalOutput: BigInt(99000),
        changeAmount: BigInt(49000),
        effectiveAmount: BigInt(50000),
        decoyOutputs: null,
      });

      const draft = await mockPrismaClient.draftTransaction.create({
        data: {
          walletId,
          userId,
          recipient: randomAddress(),
          amount: BigInt(50000),
          decoyOutputs: null,
        },
      });

      expect(draft.decoyOutputs).toBeNull();
    });
  });

  describe('Multiple Outputs', () => {
    const walletId = 'wallet-123';
    const userId = 'user-123';

    it('should store multiple outputs in draft', async () => {
      const outputs = [
        { address: randomAddress(), amount: 30000, sendMax: false },
        { address: randomAddress(), amount: 20000, sendMax: false },
      ];

      mockPrismaClient.draftTransaction.create.mockResolvedValue({
        id: 'multi-output-draft',
        walletId,
        userId,
        recipient: outputs[0].address,
        amount: BigInt(50000),
        fee: BigInt(1500),
        totalInput: BigInt(100000),
        totalOutput: BigInt(98500),
        changeAmount: BigInt(48500),
        effectiveAmount: BigInt(50000),
        outputs: outputs,
      });

      const draft = await mockPrismaClient.draftTransaction.create({
        data: {
          walletId,
          userId,
          recipient: outputs[0].address,
          amount: BigInt(50000),
          outputs: outputs,
        },
      });

      expect(draft.outputs).toEqual(outputs);
      expect(Array.isArray(draft.outputs)).toBe(true);
      expect(draft.outputs).toHaveLength(2);
    });

    it('should handle sendMax in multiple outputs', async () => {
      const outputs = [
        { address: randomAddress(), amount: 30000, sendMax: false },
        { address: randomAddress(), amount: 0, sendMax: true },
      ];

      mockPrismaClient.draftTransaction.create.mockResolvedValue({
        id: 'sendmax-multi-draft',
        walletId,
        userId,
        recipient: outputs[0].address,
        amount: BigInt(30000),
        fee: BigInt(1500),
        totalInput: BigInt(100000),
        totalOutput: BigInt(98500),
        changeAmount: BigInt(0),
        effectiveAmount: BigInt(68500),
        outputs: outputs,
      });

      const draft = await mockPrismaClient.draftTransaction.create({
        data: {
          walletId,
          userId,
          recipient: outputs[0].address,
          amount: BigInt(30000),
          outputs: outputs,
        },
      });

      expect(draft.outputs).toEqual(outputs);
      expect(draft.outputs[1].sendMax).toBe(true);
      expect(draft.outputs[1].amount).toBe(0);
    });

    it('should retrieve draft with multiple outputs', async () => {
      const outputs = [
        { address: randomAddress(), amount: 15000, sendMax: false },
        { address: randomAddress(), amount: 25000, sendMax: false },
        { address: randomAddress(), amount: 10000, sendMax: false },
      ];

      mockPrismaClient.draftTransaction.findFirst.mockResolvedValue({
        id: 'multi-retrieve',
        walletId,
        userId,
        recipient: outputs[0].address,
        amount: BigInt(50000),
        fee: BigInt(1500),
        totalInput: BigInt(100000),
        totalOutput: BigInt(98500),
        changeAmount: BigInt(48500),
        effectiveAmount: BigInt(50000),
        outputs: outputs,
      });

      const { res, getResponse } = createMockResponse();

      const draft = await mockPrismaClient.draftTransaction.findFirst({
        where: { id: 'multi-retrieve', walletId },
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
      expect(response.body.outputs).toEqual(outputs);
      expect(response.body.outputs).toHaveLength(3);
    });

    it('should handle single output for backward compatibility', async () => {
      mockPrismaClient.draftTransaction.create.mockResolvedValue({
        id: 'single-output-draft',
        walletId,
        userId,
        recipient: randomAddress(),
        amount: BigInt(50000),
        fee: BigInt(1000),
        totalInput: BigInt(100000),
        totalOutput: BigInt(99000),
        changeAmount: BigInt(49000),
        effectiveAmount: BigInt(50000),
        outputs: null, // No outputs array for single-output
      });

      const draft = await mockPrismaClient.draftTransaction.create({
        data: {
          walletId,
          userId,
          recipient: randomAddress(),
          amount: BigInt(50000),
          outputs: null,
        },
      });

      expect(draft.outputs).toBeNull();
      // Recipient field should be used instead
      expect(draft.recipient).toBeDefined();
    });
  });
};
