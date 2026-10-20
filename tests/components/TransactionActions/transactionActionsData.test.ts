/**
 * Tests for transactionActionsData.ts
 *
 * `rbfDraftRequest` builds the draft-creation request for an RBF
 * replacement. The memo it generates is display text only; the structural
 * `replacesTxid` linkage the broadcast endpoint verifies must be produced
 * alongside it and kept separate from the draft-creation payload, since the
 * draft-creation schema has no such field. See iteration-18 plan Phase 5
 * (rbf-memo-prefix-spoofs-transaction-replacement).
 */
import { describe, expect, it } from 'vitest';
import { cpfpDraftRequest, errorMessage, rbfDraftRequest } from '../../../src/components/TransactionActions/transactionActionsData';
import type { CPFPTransactionResponse, RBFCheckResult, RBFTransactionResponse } from '../../../src/api/bitcoin';

const txid = 'a'.repeat(64);

const rbfStatus: RBFCheckResult = {
  replaceable: true,
  currentFeeRate: 10,
  minNewFeeRate: 15,
};

const result: RBFTransactionResponse = {
  psbtBase64: 'cHNidP8...',
  signingContext: {} as RBFTransactionResponse['signingContext'],
  intentId: 'intent-1',
  intentDigest: 'b'.repeat(64),
  fee: 2000,
  feeRate: 20,
  feeDelta: 1000,
  inputs: [{ txid: 'prev-input-txid', vout: 0, value: 50000 }],
  outputs: [{ address: 'bc1qrecipient', value: 47000, isChange: false }],
  recipient: 'bc1qrecipient',
  amount: 47000,
};

describe('rbfDraftRequest', () => {
  it('sends a structural replacesTxid alongside the draft-creation request', () => {
    const request = rbfDraftRequest({ originalLabel: 'Original label', rbfStatus, result, txid });

    expect(request.replacesTxid).toBe(txid);
  });

  it('keeps the memo purely descriptive (the server no longer inspects it)', () => {
    const request = rbfDraftRequest({ originalLabel: 'Original label', rbfStatus, result, txid });

    expect(request.memo).toBe(`Replacing transaction ${txid}`);
  });

  it('preserves the original label when provided', () => {
    const request = rbfDraftRequest({ originalLabel: 'Original label', rbfStatus, result, txid });

    expect(request.label).toBe('Original label');
  });

  it('falls back to a generated label when no original label exists', () => {
    const request = rbfDraftRequest({ originalLabel: null, rbfStatus, result, txid });

    expect(request.label).toBe('RBF: Fee bump from 10 to 20 sat/vB');
  });

  it('builds the rest of the draft request from the RBF result', () => {
    const request = rbfDraftRequest({ originalLabel: undefined, rbfStatus, result, txid });

    expect(request).toMatchObject({
      recipient: 'bc1qrecipient',
      amount: 47000,
      feeRate: 20,
      selectedUtxoIds: ['prev-input-txid:0'],
      enableRBF: true,
      subtractFees: false,
      sendMax: false,
      isRBF: true,
      psbtBase64: 'cHNidP8...',
      intentId: 'intent-1',
      intentDigest: 'b'.repeat(64),
      fee: 2000,
      totalInput: 50000,
      totalOutput: 47000,
      changeAmount: 0,
      effectiveAmount: 47000,
      inputPaths: [],
    });
  });

  it('picks the first non-change output as recipient when change is listed first', () => {
    // Regression for rbf-draft-recipient-picks-arbitrary-output-not-change-aware:
    // `result.outputs[0]` used to be treated as the recipient unconditionally.
    // With change at index 0, that picked the wallet's own change address as
    // the "recipient" and always reported changeAmount: 0.
    const changeFirstResult: RBFTransactionResponse = {
      ...result,
      outputs: [
        { address: 'bc1qchange', value: 53000, isChange: true },
        { address: 'bc1qrecipient', value: 47000, isChange: false },
      ],
    };

    const request = rbfDraftRequest({
      originalLabel: undefined,
      rbfStatus,
      result: changeFirstResult,
      txid,
    });

    expect(request.recipient).toBe('bc1qrecipient');
    expect(request.amount).toBe(47000);
    expect(request.effectiveAmount).toBe(47000);
    expect(request.changeAmount).toBe(53000);
    expect(request.changeAddress).toBe('bc1qchange');
    expect(request.outputs).toEqual([{ address: 'bc1qrecipient', amount: 47000 }]);
  });

  it('reports no change when every output is non-change', () => {
    const noChangeResult: RBFTransactionResponse = {
      ...result,
      outputs: [{ address: 'bc1qrecipient', value: 47000, isChange: false }],
    };

    const request = rbfDraftRequest({
      originalLabel: undefined,
      rbfStatus,
      result: noChangeResult,
      txid,
    });

    expect(request.changeAmount).toBe(0);
    expect(request.changeAddress).toBeUndefined();
    expect(request.outputs).toEqual([{ address: 'bc1qrecipient', amount: 47000 }]);
  });

  it('treats every output as a recipient when all are flagged as change, and reports no change', () => {
    // Defensive edge case: `RBFTransactionResponseSchema` requires at least
    // one output but does not guarantee any of them is non-change. Nothing is
    // distinguishable as change here, so `outputs` must stay non-empty (the
    // server rejects a draft with none) and `changeAmount`/`changeAddress`
    // must stay unset rather than double-counting the same output as both a
    // recipient and change.
    const allChangeResult: RBFTransactionResponse = {
      ...result,
      outputs: [{ address: 'bc1qchange', value: 53000, isChange: true }],
      recipient: null,
      amount: null,
    };

    const request = rbfDraftRequest({
      originalLabel: undefined,
      rbfStatus,
      result: allChangeResult,
      txid,
    });

    expect(request.recipient).toBe('bc1qchange');
    expect(request.amount).toBe(53000);
    expect(request.outputs).toEqual([{ address: 'bc1qchange', amount: 53000 }]);
    expect(request.changeAmount).toBe(0);
    expect(request.changeAddress).toBeUndefined();
  });

  describe('canonical spend (rbf-draft--multi-recipient-amount-recipient-mismatch)', () => {
    it('uses the summed amount of a multi-recipient replacement and keeps the canonical recipient first', () => {
      const request = rbfDraftRequest({
        originalLabel: undefined,
        rbfStatus,
        txid,
        result: {
          ...result,
          outputs: [
            { address: 'bc1qfirst', value: 40000, isChange: false },
            { address: 'bc1qsecond', value: 30000, isChange: false },
            { address: 'bc1qchange', value: 28000, isChange: true },
          ],
          recipient: 'bc1qfirst',
          amount: 70000,
        },
      });

      expect(request).toMatchObject({
        recipient: 'bc1qfirst',
        amount: 70000,
        effectiveAmount: 70000,
        changeAmount: 28000,
        changeAddress: 'bc1qchange',
      });
      expect(request.outputs).toEqual([
        { address: 'bc1qfirst', amount: 40000 },
        { address: 'bc1qsecond', amount: 30000 },
      ]);
    });

    it('puts the external recipient first when the wallet\'s own receive output comes first', () => {
      // isChange only knows branch-1 addresses, so the wallet's own receive
      // output is "non-change" and used to become the draft recipient.
      const request = rbfDraftRequest({
        originalLabel: undefined,
        rbfStatus,
        txid,
        result: {
          ...result,
          outputs: [
            { address: 'bc1qownreceive', value: 10000, isChange: false },
            { address: 'bc1qexternal', value: 40000, isChange: false },
            { address: 'bc1qchange', value: 48000, isChange: true },
          ],
          recipient: 'bc1qexternal',
          amount: 40000,
        },
      });

      expect(request).toMatchObject({ recipient: 'bc1qexternal', amount: 40000, effectiveAmount: 40000 });
      expect(request.outputs).toEqual([
        { address: 'bc1qexternal', amount: 40000 },
        { address: 'bc1qownreceive', amount: 10000 },
      ]);
    });

    it.each([
      [{ recipient: 'bc1qrecipient', amount: null }],
      [{ recipient: null, amount: 47000 }],
    ])('treats a half-present canonical spend %j as none', (canonical) => {
      const request = rbfDraftRequest({ originalLabel: undefined, rbfStatus, txid, result: { ...result, ...canonical } });

      expect(request).toMatchObject({ recipient: 'bc1qrecipient', amount: 47000, effectiveAmount: 47000 });
    });

    it('keeps today\'s positive amount, recipient and output order for a consolidation', () => {
      const request = rbfDraftRequest({
        originalLabel: undefined,
        rbfStatus,
        txid,
        result: {
          ...result,
          outputs: [
            { address: 'bc1qownreceive', value: 150000, isChange: false },
            { address: 'bc1qownother', value: 5000, isChange: false },
            { address: 'bc1qchange', value: 40000, isChange: true },
          ],
          recipient: null,
          amount: null,
        },
      });

      expect(request).toMatchObject({
        recipient: 'bc1qownreceive',
        amount: 150000,
        effectiveAmount: 150000,
        changeAmount: 40000,
      });
      expect(request.outputs).toEqual([
        { address: 'bc1qownreceive', amount: 150000 },
        { address: 'bc1qownother', amount: 5000 },
      ]);
    });
  });
});

describe('errorMessage', () => {
  it('returns the Error message when given an Error', () => {
    expect(errorMessage(new Error('boom'), 'fallback')).toBe('boom');
  });

  it('returns the fallback for a non-Error value', () => {
    expect(errorMessage('not an error', 'fallback')).toBe('fallback');
  });
});

describe('cpfpDraftRequest', () => {
  const cpfpResult: CPFPTransactionResponse = {
    psbtBase64: 'cHNidP8cpfp',
    signingContext: {} as CPFPTransactionResponse['signingContext'],
    intentId: 'intent-cpfp',
    intentDigest: 'c'.repeat(64),
    childFee: 3000,
    childFeeRate: 40,
    parentFeeRate: 2,
    effectiveFeeRate: 21,
    inputs: [{ txid: 'parent-txid', vout: 1, value: 50000 }],
    outputs: [{ address: 'bc1qown', value: 47000, isChange: false }],
  };

  it('maps the server child transaction onto a non-RBF draft request', () => {
    const request = cpfpDraftRequest({ parentTxid: txid, result: cpfpResult });

    expect(request).toEqual({
      recipient: 'bc1qown',
      amount: 47000,
      feeRate: 40,
      fee: 3000,
      selectedUtxoIds: ['parent-txid:1'],
      enableRBF: false,
      isRBF: false,
      subtractFees: false,
      sendMax: false,
      outputs: [{ address: 'bc1qown', amount: 47000 }],
      label: `CPFP: accelerate ${txid.slice(0, 8)}...`,
      memo: `Accelerating transaction ${txid}`,
      psbtBase64: 'cHNidP8cpfp',
      intentId: 'intent-cpfp',
      intentDigest: 'c'.repeat(64),
      totalInput: 50000,
      totalOutput: 47000,
      changeAmount: 0,
      effectiveAmount: 47000,
      inputPaths: [],
    });
  });
});
