import { describe, expect, it } from 'vitest';
import {
  CreateDraftRequestSchema,
  UpdateDraftRequestSchema,
} from '@sanctuary/shared/schemas/draftRequests';

export const registerDraftValidationContracts = () => {
  describe('draft request schema validation', () => {
    const createRequest = {
      recipient: 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx',
      amount: '50000',
      feeRate: '1.5',
      psbtBase64: 'cHNidP8BAHUCAAAAAAE=',
      intentId: 'intent-1',
      intentDigest: 'a'.repeat(64),
    };

    it('accepts nullable update metadata used to clear labels and memos', () => {
      expect(UpdateDraftRequestSchema.safeParse({
        label: null,
        memo: null,
      }).success).toBe(true);
    });

    it('rejects malformed update metadata', () => {
      expect(UpdateDraftRequestSchema.safeParse({
        label: ['payment'],
      }).success).toBe(false);
      expect(UpdateDraftRequestSchema.safeParse({
        memo: { text: 'payment' },
      }).success).toBe(false);
    });

    it('accepts nested numeric-string amount fields in create requests', () => {
      const result = CreateDraftRequestSchema.safeParse({
        ...createRequest,
        label: null,
        memo: null,
        outputs: [
          { address: 'tb1qoutput', amount: '25000' },
        ],
        inputs: [
          {
            txid: 'b'.repeat(64),
            vout: 0,
            address: 'tb1qinput',
            amount: '50000',
          },
        ],
        decoyOutputs: [
          { address: 'tb1qdecoy', amount: '1000' },
        ],
        fee: '500',
        totalInput: '50000',
        totalOutput: '49500',
        changeAmount: '24500',
        effectiveAmount: '25000',
      });

      expect(result.success).toBe(true);
    });

    it.each([
      ['outputs', { outputs: [{ address: 'tb1qoutput', amount: { sats: 25000 } }] }],
      ['inputs', { inputs: [{ txid: 'b'.repeat(64), vout: 0, address: 'tb1qinput', amount: { sats: 50000 } }] }],
      ['decoyOutputs', { decoyOutputs: [{ address: 'tb1qdecoy', amount: { sats: 1000 } }] }],
    ])('rejects object values for nested %s amount fields', (_field, override) => {
      const result = CreateDraftRequestSchema.safeParse({
        ...createRequest,
        ...override,
      });

      expect(result.success).toBe(false);
    });
  });
};
