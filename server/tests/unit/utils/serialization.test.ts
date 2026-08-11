/**
 * Serialization Utilities Tests
 *
 * Tests for JSON serialization helpers that convert Prisma models
 * with BigInt fields to JSON-safe formats.
 */

import { describe, it, expect } from 'vitest';
import type { DraftTransaction } from '../../../src/generated/prisma/client';
import {
  serializeDraftTransaction,
  serializeDraftTransactions,
} from '../../../src/utils/serialization';

describe('Serialization Utilities', () => {
  // Mock base draft transaction with BigInt fields
  const createMockDraft = (overrides?: Partial<DraftTransaction>): DraftTransaction => ({
    id: 'draft-123',
    walletId: 'wallet-456',
    userId: 'user-789',
    recipient: 'bc1qrecipient...',
    psbtBase64: 'cHNidP8B...',
    signedPsbtBase64: null,
    status: 'pending',
    amount: BigInt(100000),
    fee: BigInt(500),
    feeRate: 5.0,
    totalInput: BigInt(150000),
    totalOutput: BigInt(100500),
    changeAmount: BigInt(49500),
    effectiveAmount: BigInt(99500),
    selectedUtxoIds: ['txid:0'],
    enableRBF: true,
    subtractFees: false,
    sendMax: false,
    outputs: [{ address: 'bc1q...', amount: 100000 }],
    inputs: null,
    decoyOutputs: null,
    payjoinUrl: null,
    isRBF: false,
    label: null,
    memo: null,
    changeAddress: 'bc1qchange...',
    inputPaths: ["m/84'/0'/0'/0/0"],
    signingIntentId: null,
    signingIntentDigest: null,
    signingContext: null,
    signedDeviceIds: [],
    agentId: null,
    agentOperationalWalletId: null,
    expiresAt: new Date('2026-01-12T00:00:00Z'),
    approvalStatus: 'not_required',
    policySnapshot: null,
    approvedAt: null,
    approvedBy: null,
    createdAt: new Date('2026-01-11T00:00:00Z'),
    updatedAt: new Date('2026-01-11T00:00:00Z'),
    ...overrides,
  });

  describe('serializeDraftTransaction', () => {
    it('should convert BigInt amount to number', () => {
      const draft = createMockDraft({ amount: BigInt(100000) });
      const result = serializeDraftTransaction(draft);

      expect(result.amount).toBe(100000);
      expect(typeof result.amount).toBe('number');
    });

    it('should convert BigInt fee to number', () => {
      const draft = createMockDraft({ fee: BigInt(500) });
      const result = serializeDraftTransaction(draft);

      expect(result.fee).toBe(500);
      expect(typeof result.fee).toBe('number');
    });

    it('should convert BigInt totalInput to number', () => {
      const draft = createMockDraft({ totalInput: BigInt(150000) });
      const result = serializeDraftTransaction(draft);

      expect(result.totalInput).toBe(150000);
      expect(typeof result.totalInput).toBe('number');
    });

    it('should convert BigInt totalOutput to number', () => {
      const draft = createMockDraft({ totalOutput: BigInt(100500) });
      const result = serializeDraftTransaction(draft);

      expect(result.totalOutput).toBe(100500);
      expect(typeof result.totalOutput).toBe('number');
    });

    it('should convert BigInt changeAmount to number', () => {
      const draft = createMockDraft({ changeAmount: BigInt(49500) });
      const result = serializeDraftTransaction(draft);

      expect(result.changeAmount).toBe(49500);
      expect(typeof result.changeAmount).toBe('number');
    });

    it('should convert BigInt effectiveAmount to number', () => {
      const draft = createMockDraft({ effectiveAmount: BigInt(99500) });
      const result = serializeDraftTransaction(draft);

      expect(result.effectiveAmount).toBe(99500);
      expect(typeof result.effectiveAmount).toBe('number');
    });

    it('should preserve non-BigInt fields', () => {
      const draft = createMockDraft({
        id: 'test-id',
        walletId: 'test-wallet',
        status: 'pending',
        feeRate: 5.5,
        enableRBF: true,
      });
      const result = serializeDraftTransaction(draft);

      expect(result.id).toBe('test-id');
      expect(result.walletId).toBe('test-wallet');
      expect(result.status).toBe('pending');
      expect(result.feeRate).toBe(5.5);
      expect(result.enableRBF).toBe(true);
    });

    it('should preserve Date objects', () => {
      const createdAt = new Date('2026-01-11T12:00:00Z');
      const draft = createMockDraft({ createdAt });
      const result = serializeDraftTransaction(draft);

      expect(result.createdAt).toEqual(createdAt);
    });

    it('should handle zero values', () => {
      const draft = createMockDraft({
        amount: BigInt(0),
        fee: BigInt(0),
        changeAmount: BigInt(0),
      });
      const result = serializeDraftTransaction(draft);

      expect(result.amount).toBe(0);
      expect(result.fee).toBe(0);
      expect(result.changeAmount).toBe(0);
    });

    it('should handle large BigInt values', () => {
      // Max safe integer in JavaScript
      const largeAmount = BigInt(Number.MAX_SAFE_INTEGER);
      const draft = createMockDraft({ amount: largeAmount });
      const result = serializeDraftTransaction(draft);

      expect(result.amount).toBe(Number.MAX_SAFE_INTEGER);
    });

    it('should handle negative amounts (edge case)', () => {
      // While negative amounts should not exist in practice,
      // the function should still convert them
      const draft = createMockDraft({ amount: BigInt(-100) });
      const result = serializeDraftTransaction(draft);

      expect(result.amount).toBe(-100);
    });

    it('should preserve null optional fields', () => {
      const draft = createMockDraft({
        signedPsbtBase64: null,
        payjoinUrl: null,
        expiresAt: null,
      });
      const result = serializeDraftTransaction(draft);

      expect(result.signedPsbtBase64).toBeNull();
      expect(result.payjoinUrl).toBeNull();
      expect(result.expiresAt).toBeNull();
    });
  });

  describe('serializeDraftTransactions', () => {
    it('should serialize an empty array', () => {
      const result = serializeDraftTransactions([]);

      expect(result).toEqual([]);
      expect(Array.isArray(result)).toBe(true);
    });

    it('should serialize a single draft', () => {
      const draft = createMockDraft({ amount: BigInt(100000) });
      const result = serializeDraftTransactions([draft]);

      expect(result).toHaveLength(1);
      expect(result[0].amount).toBe(100000);
    });

    it('should serialize multiple drafts', () => {
      const drafts = [
        createMockDraft({ id: 'draft-1', amount: BigInt(100000) }),
        createMockDraft({ id: 'draft-2', amount: BigInt(200000) }),
        createMockDraft({ id: 'draft-3', amount: BigInt(300000) }),
      ];
      const result = serializeDraftTransactions(drafts);

      expect(result).toHaveLength(3);
      expect(result[0].id).toBe('draft-1');
      expect(result[0].amount).toBe(100000);
      expect(result[1].id).toBe('draft-2');
      expect(result[1].amount).toBe(200000);
      expect(result[2].id).toBe('draft-3');
      expect(result[2].amount).toBe(300000);
    });

    it('should preserve order of drafts', () => {
      const drafts = [
        createMockDraft({ id: 'first' }),
        createMockDraft({ id: 'second' }),
        createMockDraft({ id: 'third' }),
      ];
      const result = serializeDraftTransactions(drafts);

      expect(result[0].id).toBe('first');
      expect(result[1].id).toBe('second');
      expect(result[2].id).toBe('third');
    });

    it('should convert all BigInt fields in each draft', () => {
      const drafts = [
        createMockDraft({
          amount: BigInt(100000),
          fee: BigInt(500),
          totalInput: BigInt(150000),
        }),
        createMockDraft({
          amount: BigInt(200000),
          fee: BigInt(1000),
          totalInput: BigInt(250000),
        }),
      ];
      const result = serializeDraftTransactions(drafts);

      // First draft
      expect(typeof result[0].amount).toBe('number');
      expect(typeof result[0].fee).toBe('number');
      expect(typeof result[0].totalInput).toBe('number');

      // Second draft
      expect(typeof result[1].amount).toBe('number');
      expect(typeof result[1].fee).toBe('number');
      expect(typeof result[1].totalInput).toBe('number');
    });

    it('should not mutate the original array', () => {
      const original = createMockDraft({ amount: BigInt(100000) });
      const drafts = [original];
      serializeDraftTransactions(drafts);

      // Original should still have BigInt
      expect(drafts[0].amount).toBe(BigInt(100000));
      expect(typeof drafts[0].amount).toBe('bigint');
    });
  });
});
