import { describe, expect, it } from 'vitest';

import {
  BatchTransactionResponseSchema,
  CPFPTransactionResponseSchema,
  FeeEstimatesSchema,
  HardwarePsbtCreateResponseSchema,
  PayjoinAttemptResponseSchema,
  RBFTransactionResponseSchema,
} from '../../shared/schemas/bitcoinResponses';
import { testPsbtSigningContext } from '../fixtures/psbtSigningContext';

const valid = { fastest: 18, halfHour: 12, hour: 8, economy: 3 };

describe('FeeEstimatesSchema', () => {
  it('accepts a well-formed estimate, with and without the optional minimum', () => {
    expect(FeeEstimatesSchema.parse(valid)).toEqual(valid);
    expect(FeeEstimatesSchema.parse({ ...valid, minimum: 1 })).toEqual({ ...valid, minimum: 1 });
  });

  it('accepts fractional and zero rates', () => {
    // Sub-1 sat/vB is ordinary on a quiet mempool, and 0 is odd but readable —
    // whether a rate is *usable* is `usableFeeRate`'s call, not this schema's.
    const quiet = { fastest: 0.4, halfHour: 0.3, hour: 0.2, economy: 0 };
    expect(FeeEstimatesSchema.parse(quiet)).toEqual(quiet);
  });

  it('rejects the values that actually reached the formatters', () => {
    // null crashed the dashboard via `.toFixed` (#736) and became 1 sat/vB in
    // the send flow (#738).
    expect(FeeEstimatesSchema.safeParse({ ...valid, fastest: null }).success).toBe(false);
    expect(FeeEstimatesSchema.safeParse({ ...valid, fastest: undefined }).success).toBe(false);
    expect(FeeEstimatesSchema.safeParse({ ...valid, fastest: '18' }).success).toBe(false);
    expect(FeeEstimatesSchema.safeParse({ ...valid, fastest: Number.NaN }).success).toBe(false);
    expect(FeeEstimatesSchema.safeParse({ ...valid, fastest: Number.POSITIVE_INFINITY }).success).toBe(false);
  });

  it('rejects a missing field rather than reading it as absent', () => {
    const { hour: _hour, ...missing } = valid;
    expect(FeeEstimatesSchema.safeParse(missing).success).toBe(false);
  });

  it('rejects a body that is not an object at all', () => {
    for (const body of [null, undefined, 'nope', 42, []]) {
      expect(FeeEstimatesSchema.safeParse(body).success).toBe(false);
    }
  });

  it('strips unknown keys instead of refusing them', () => {
    // Responses are not requests: the server may add fields, and a client that
    // rejected them would break the moment it lagged a deploy.
    const withExtra = { ...valid, someFutureField: 'added by a newer server' };

    const parsed = FeeEstimatesSchema.parse(withExtra);

    expect(parsed).toEqual(valid);
    expect('someFutureField' in parsed).toBe(false);
  });

  it('reports the failing field so a log line can name it', () => {
    const result = FeeEstimatesSchema.safeParse({ ...valid, economy: null });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path).toEqual(['economy']);
    }
  });
});

const rbf = {
  psbtBase64: 'cHNidP8BAHECAAAAAf',
  signingContext: testPsbtSigningContext,
  intentId: 'intent-rbf',
  intentDigest: 'a'.repeat(64),
  fee: 5000,
  feeRate: 24,
  feeDelta: 2500,
  inputs: [{ txid: 'a'.repeat(64), vout: 0, value: 500000 }],
  outputs: [{ address: 'bc1qexample', value: 495000 }],
};

describe('RBFTransactionResponseSchema', () => {
  it('accepts a well-formed replacement', () => {
    expect(RBFTransactionResponseSchema.parse(rbf)).toEqual(rbf);
  });

  it('rejects empty input or output lists', () => {
    // `transactionActionsData` reads `outputs[0].address` directly, so an empty
    // list is a TypeError; and a transaction with none of either is not one.
    expect(RBFTransactionResponseSchema.safeParse({ ...rbf, outputs: [] }).success).toBe(false);
    expect(RBFTransactionResponseSchema.safeParse({ ...rbf, inputs: [] }).success).toBe(false);
  });

  it('rejects a missing list rather than letting reduce throw', () => {
    expect(RBFTransactionResponseSchema.safeParse({ ...rbf, outputs: null }).success).toBe(false);
  });

  it('rejects fee figures that are not numbers', () => {
    for (const field of ['fee', 'feeRate', 'feeDelta']) {
      expect(RBFTransactionResponseSchema.safeParse({ ...rbf, [field]: null }).success).toBe(false);
    }
    // This result is fed straight into a persisted draft.
    expect(RBFTransactionResponseSchema.safeParse({ ...rbf, psbtBase64: '' }).success).toBe(false);
  });

  it('rejects an output value that is not a number', () => {
    const bad = { ...rbf, outputs: [{ address: 'bc1qexample', value: null }] };
    expect(RBFTransactionResponseSchema.safeParse(bad).success).toBe(false);
  });
});

describe('advanced transaction signing response schemas', () => {
  const signingIntent = {
    psbtBase64: 'cHNidP8BAHECAAAAAf',
    signingContext: testPsbtSigningContext,
    intentId: 'intent-advanced',
    intentDigest: 'd'.repeat(64),
  };

  it('accepts CPFP and batch responses carrying server-issued signing evidence', () => {
    expect(CPFPTransactionResponseSchema.parse({
      ...signingIntent,
      childFee: 1000,
      childFeeRate: 10,
      parentFeeRate: 2,
      effectiveFeeRate: 6,
    }).signingContext).toEqual(testPsbtSigningContext);
    expect(BatchTransactionResponseSchema.parse({
      ...signingIntent,
      fee: 1000,
      totalInput: 10_000,
      totalOutput: 8_500,
      changeAmount: 500,
      savedFees: 200,
      recipientCount: 2,
    }).signingContext).toEqual(testPsbtSigningContext);
  });

  it.each([
    ['RBF', RBFTransactionResponseSchema, rbf],
    ['CPFP', CPFPTransactionResponseSchema, { ...signingIntent, childFee: 1, childFeeRate: 1, parentFeeRate: 1, effectiveFeeRate: 1 }],
    ['batch', BatchTransactionResponseSchema, { ...signingIntent, fee: 1, totalInput: 2, totalOutput: 1, changeAmount: 0, savedFees: 0, recipientCount: 1 }],
  ])('rejects %s responses without valid signing evidence', (_name, schema, response) => {
    expect(schema.safeParse({ ...response, signingContext: undefined }).success).toBe(false);
    expect(schema.safeParse({ ...response, signingContext: { ...testPsbtSigningContext, walletId: '' } }).success).toBe(false);
  });
});

describe('hardware and Payjoin signing response schemas', () => {
  const signingEvidence = {
    signingContext: testPsbtSigningContext,
    intentId: 'intent-hardware',
    intentDigest: 'e'.repeat(64),
  };

  it('requires complete signing evidence from the hardware PSBT endpoint', () => {
    const response = { psbt: 'cHNidP8BAHECAAAAAf', fee: 500, ...signingEvidence };
    expect(HardwarePsbtCreateResponseSchema.parse(response)).toEqual(response);
    expect(HardwarePsbtCreateResponseSchema.safeParse({
      ...response,
      signingContext: undefined,
    }).success).toBe(false);
  });

  it('accepts either a complete Payjoin replacement or an explicit fallback', () => {
    const replacement = {
      success: true as const,
      isPayjoin: true as const,
      proposalPsbt: 'cHNidP8BAHECAAAAAf',
      ...signingEvidence,
    };
    expect(PayjoinAttemptResponseSchema.parse(replacement)).toEqual(replacement);
    expect(PayjoinAttemptResponseSchema.parse({
      success: false,
      isPayjoin: false,
      error: 'receiver unavailable',
    })).toEqual({ success: false, isPayjoin: false, error: 'receiver unavailable' });
  });

  it('rejects partial or contradictory successful Payjoin evidence', () => {
    const replacement = {
      success: true,
      isPayjoin: true,
      proposalPsbt: 'cHNidP8BAHECAAAAAf',
      ...signingEvidence,
    };
    for (const field of ['proposalPsbt', 'signingContext', 'intentId', 'intentDigest']) {
      expect(PayjoinAttemptResponseSchema.safeParse({
        ...replacement,
        [field]: undefined,
      }).success).toBe(false);
    }
    expect(PayjoinAttemptResponseSchema.safeParse({
      ...replacement,
      isPayjoin: false,
    }).success).toBe(false);
  });
});
