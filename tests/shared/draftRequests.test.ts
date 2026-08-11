import { describe, expect, it } from 'vitest';

import {
  CreateDraftRequestSchema,
  UpdateDraftRequestSchema,
} from '../../shared/schemas/draftRequests';

const validCreateDraftRequest = {
  recipient: 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx',
  amount: '50000',
  feeRate: '1.5',
  psbtBase64: 'cHNidP8BAHUCAAAAAAE=',
  intentId: 'intent-1',
  intentDigest: 'a'.repeat(64),
};

describe('shared draft request schemas', () => {
  it('accepts nested numeric-string draft amount fields and nullable metadata', () => {
    const result = CreateDraftRequestSchema.safeParse({
      ...validCreateDraftRequest,
      label: null,
      memo: null,
      outputs: [
        { address: 'tb1qoutput', amount: '25000', sendMax: false },
      ],
      inputs: [
        {
          txid: 'a'.repeat(64),
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
      inputPaths: ["m/84'/1'/0'/0/0"],
    });

    expect(result.success).toBe(true);
  });

  it('rejects invalid draft amount values', () => {
    const invalidAmounts = [
      { amount: -1 },
      { amount: 1.5 },
      { amount: '1.5' },
      { amount: { sats: 1 } },
      { amount: ['1'] },
    ];

    for (const override of invalidAmounts) {
      expect(CreateDraftRequestSchema.safeParse({
        ...validCreateDraftRequest,
        ...override,
      }).success).toBe(false);
    }
  });

  it('accepts nullable metadata updates and rejects non-string metadata objects', () => {
    expect(CreateDraftRequestSchema.safeParse({
      ...validCreateDraftRequest,
      feeRate: 0,
    }).success).toBe(false);

    expect(UpdateDraftRequestSchema.safeParse({
      label: null,
      memo: null,
    }).success).toBe(true);

    expect(UpdateDraftRequestSchema.safeParse({
      label: { text: 'payment' },
    }).success).toBe(false);
  });
});
