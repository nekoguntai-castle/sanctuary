import { describe, expect, it } from 'vitest';

import { BatchTransactionRequestSchema } from '../../shared/schemas/batchTransactionRequests';

const validRequest = {
  feeRate: 1,
  outputs: [
    { address: 'tb1qone', amount: 10000 },
    { address: 'tb1qtwo', amount: 5000 },
  ],
};

describe('shared batch transaction request schemas', () => {
  it('accepts the documented happy-path batch shape', () => {
    expect(BatchTransactionRequestSchema.safeParse(validRequest).success).toBe(true);
  });

  it('accepts optional selectedUtxoIds, enableRBF, label, memo', () => {
    const result = BatchTransactionRequestSchema.safeParse({
      ...validRequest,
      selectedUtxoIds: ['utxo-1'],
      enableRBF: false,
      label: 'a label',
      memo: 'a memo',
    });
    expect(result.success).toBe(true);
  });

  it('accepts a single sendMax output without amount', () => {
    const result = BatchTransactionRequestSchema.safeParse({
      feeRate: 1,
      outputs: [{ address: 'tb1qone', sendMax: true }],
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty outputs array with the documented message', () => {
    const result = BatchTransactionRequestSchema.safeParse({ feeRate: 1, outputs: [] });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toContain('outputs array is required');
    }
  });

  it('rejects missing outputs with the documented message', () => {
    const result = BatchTransactionRequestSchema.safeParse({ feeRate: 1 });
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((issue) => issue.message);
      expect(messages.some((m) => m.includes('outputs array is required'))).toBe(true);
    }
  });

  it('rejects feeRate below the documented minimum', () => {
    const result = BatchTransactionRequestSchema.safeParse({
      feeRate: 0.01,
      outputs: [{ address: 'tb1qone', amount: 10000 }],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toContain('feeRate must be at least');
    }
  });

  it('rejects non-number feeRate', () => {
    const result = BatchTransactionRequestSchema.safeParse({
      feeRate: '1',
      outputs: [{ address: 'tb1qone', amount: 10000 }],
    });
    expect(result.success).toBe(false);
  });

  it('reports per-output index when address is missing', () => {
    const result = BatchTransactionRequestSchema.safeParse({
      feeRate: 1,
      outputs: [
        { address: 'tb1qone', amount: 10000 },
        { amount: 5000 },
      ],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((issue) => issue.message);
      expect(messages.some((m) => m.includes('Output 2: address is required'))).toBe(true);
    }
  });

  it('reports per-output index when amount is missing and sendMax is false', () => {
    const result = BatchTransactionRequestSchema.safeParse({
      feeRate: 1,
      outputs: [{ address: 'tb1qone' }],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((issue) => issue.message);
      expect(messages.some((m) => m.includes('Output 1: amount is required'))).toBe(true);
    }
  });

  it('reports per-output index when amount is zero and sendMax is false', () => {
    const result = BatchTransactionRequestSchema.safeParse({
      feeRate: 1,
      outputs: [{ address: 'tb1qone', amount: 0 }],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((issue) => issue.message);
      expect(messages.some((m) => m.includes('Output 1: amount is required'))).toBe(true);
    }
  });

  it('rejects when more than one output sets sendMax: true', () => {
    const result = BatchTransactionRequestSchema.safeParse({
      feeRate: 1,
      outputs: [
        { address: 'tb1qone', sendMax: true },
        { address: 'tb1qtwo', sendMax: true },
      ],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((issue) => issue.message);
      expect(messages.some((m) => m.includes('Only one output can have sendMax'))).toBe(true);
    }
  });

  it('rejects unknown root keys', () => {
    const result = BatchTransactionRequestSchema.safeParse({
      ...validRequest,
      surprise: true,
    });
    expect(result.success).toBe(false);
  });

  it('rejects unknown per-output keys', () => {
    const result = BatchTransactionRequestSchema.safeParse({
      feeRate: 1,
      outputs: [{ address: 'tb1qone', amount: 10000, surprise: true }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects non-array outputs with the documented message', () => {
    const result = BatchTransactionRequestSchema.safeParse({ feeRate: 1, outputs: 'not-an-array' });
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((issue) => issue.message);
      expect(messages.some((m) => m.includes('outputs array is required'))).toBe(true);
    }
  });
});
