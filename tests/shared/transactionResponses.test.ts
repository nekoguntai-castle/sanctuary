import { describe, expect, it } from 'vitest';

import {
  CreateTransactionResponseSchema,
  DraftTransactionSchema,
  DraftTransactionsResponseSchema,
} from '../../shared/schemas/transactionResponses';

const created = {
  psbtBase64: 'cHNidP8BAHECAAAAAf',
  fee: 2500,
  totalInput: 500000,
  totalOutput: 497500,
  changeAmount: 0,
  utxos: [{ txid: 'a'.repeat(64), vout: 0 }],
};

const draft = {
  id: 'd1',
  walletId: 'w1',
  psbtBase64: 'cHNidP8BAHECAAAAAf',
  amount: 100000,
  feeRate: 12,
  fee: 2500,
  totalInput: 500000,
  totalOutput: 497500,
  changeAmount: 397500,
  status: 'unsigned' as const,
  signedDeviceIds: [],
};

describe('CreateTransactionResponseSchema', () => {
  it('accepts a well-formed creation response', () => {
    expect(CreateTransactionResponseSchema.parse(created)).toEqual(created);
  });

  it('keeps the optional fields it does not declare', () => {
    // Partial + loose: changeAddress, effectiveAmount, inputPaths and
    // decoyOutputs must survive, or the review screen loses them silently.
    const full = {
      ...created,
      changeAddress: 'bc1qchange',
      effectiveAmount: 100000,
      inputPaths: ["m/84'/0'/0'/0/0"],
      decoyOutputs: [{ address: 'bc1qdecoy', amount: 1000 }],
    };

    expect(CreateTransactionResponseSchema.parse(full)).toEqual(full);
  });

  it('rejects an unsignable psbt', () => {
    // An empty string is not a PSBT, and putting one in front of a user who has
    // been told it is their transaction is the worst failure available here.
    expect(CreateTransactionResponseSchema.safeParse({ ...created, psbtBase64: '' }).success).toBe(false);
    expect(CreateTransactionResponseSchema.safeParse({ ...created, psbtBase64: null }).success).toBe(false);
  });

  it('rejects any review figure that is not a number', () => {
    for (const field of ['fee', 'totalInput', 'totalOutput', 'changeAmount']) {
      for (const bad of [null, undefined, Number.NaN, Number.POSITIVE_INFINITY, '2500']) {
        expect(
          CreateTransactionResponseSchema.safeParse({ ...created, [field]: bad }).success,
        ).toBe(false);
      }
    }
  });

  it('rejects a missing utxos array rather than letting .map throw', () => {
    const { utxos: _utxos, ...missing } = created;
    expect(CreateTransactionResponseSchema.safeParse(missing).success).toBe(false);
    expect(CreateTransactionResponseSchema.safeParse({ ...created, utxos: null }).success).toBe(false);
  });
});

describe('DraftTransactionSchema', () => {
  it('accepts a well-formed draft in each signing state', () => {
    for (const status of ['unsigned', 'partial', 'signed'] as const) {
      expect(DraftTransactionSchema.parse({ ...draft, status }).status).toBe(status);
    }
  });

  it('rejects a fee that would throw on toLocaleString', () => {
    // `DraftAmountSummary` calls `draft.fee.toLocaleString()` — the same crash
    // shape as the null that took the dashboard down.
    expect(DraftTransactionSchema.safeParse({ ...draft, fee: null }).success).toBe(false);
  });

  it('rejects an unrecognised signing status', () => {
    // Status drives whether a draft looks ready to broadcast.
    expect(DraftTransactionSchema.safeParse({ ...draft, status: 'nearly' }).success).toBe(false);
    expect(DraftTransactionSchema.safeParse({ ...draft, status: null }).success).toBe(false);
  });

  it('rejects a signed-device list that is not a list', () => {
    expect(DraftTransactionSchema.safeParse({ ...draft, signedDeviceIds: null }).success).toBe(false);
    expect(DraftTransactionSchema.safeParse({ ...draft, signedDeviceIds: 'device-1' }).success).toBe(false);
  });

  it('keeps the fields it does not declare', () => {
    const full = { ...draft, label: 'Rent', outputs: [{ address: 'bc1q', amount: 1 }], expiresAt: '2026-01-01' };
    expect(DraftTransactionSchema.parse(full)).toEqual(full);
  });
});

describe('DraftTransactionsResponseSchema', () => {
  it('accepts a list, including an empty one', () => {
    expect(DraftTransactionsResponseSchema.parse([])).toEqual([]);
    expect(DraftTransactionsResponseSchema.parse([draft])).toEqual([draft]);
  });

  it('rejects the whole queue when one draft is corrupt, naming it', () => {
    const result = DraftTransactionsResponseSchema.safeParse([draft, { ...draft, fee: null }]);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path).toEqual([1, 'fee']);
    }
  });

  it('rejects a body that is not a list', () => {
    for (const body of [null, undefined, {}, 'nope']) {
      expect(DraftTransactionsResponseSchema.safeParse(body).success).toBe(false);
    }
  });
});
