import { describe, expect, it } from 'vitest';

import {
  MobileDraftUpdateRequestSchema,
  MobilePsbtCreateRequestSchema,
  MobileTransactionBroadcastRequestSchema,
} from '../../shared/schemas/mobileApiRequests';

describe('mobile API transaction request schemas', () => {
  const signingIntent = { intentId: 'intent-1', intentDigest: 'a'.repeat(64) };
  it('accepts nullable draft metadata updates', () => {
    expect(MobileDraftUpdateRequestSchema.safeParse({
      label: null,
      memo: null,
    }).success).toBe(true);

    expect(MobileDraftUpdateRequestSchema.safeParse({
      label: { text: 'invalid' },
    }).success).toBe(false);
  });

  it('accepts each supported transaction broadcast source', () => {
    expect(MobileTransactionBroadcastRequestSchema.safeParse({
      signedPsbtBase64: 'cHNi',
      ...signingIntent,
    }).success).toBe(true);
    expect(MobileTransactionBroadcastRequestSchema.safeParse({
      rawTxHex: 'deadbeef',
      ...signingIntent,
    }).success).toBe(true);
    expect(MobileTransactionBroadcastRequestSchema.safeParse({
      draftId: 'draft-1',
    }).success).toBe(true);
  });

  it('rejects explicit transaction broadcast sources without a signing intent', () => {
    expect(MobileTransactionBroadcastRequestSchema.safeParse({
      signedPsbtBase64: 'cHNi',
    }).success).toBe(false);
    expect(MobileTransactionBroadcastRequestSchema.safeParse({
      rawTxHex: 'deadbeef',
    }).success).toBe(false);
  });

  it('accepts draft-bound explicit transaction broadcast payloads', () => {
    expect(MobileTransactionBroadcastRequestSchema.safeParse({
      draftId: 'draft-1',
      signedPsbtBase64: 'cHNi',
      recipient: 'tb1qrecipient',
      amount: 10000,
      fee: 100,
      utxos: [{ txid: 'a'.repeat(64), vout: 0 }],
    }).success).toBe(true);
    expect(MobileTransactionBroadcastRequestSchema.safeParse({
      draftId: 'draft-1',
      rawTxHex: 'deadbeef',
    }).success).toBe(true);
  });

  it('rejects transaction broadcasts without a signed source', () => {
    const result = MobileTransactionBroadcastRequestSchema.safeParse({
      recipient: 'tb1qrecipient',
      amount: 10000,
      fee: 100,
      utxos: [{ txid: 'a'.repeat(64), vout: 0 }],
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        message: 'Either signedPsbtBase64, rawTxHex, or draftId is required',
      }),
    ]));
  });

  it('rejects transaction broadcasts with both explicit signed sources', () => {
    const result = MobileTransactionBroadcastRequestSchema.safeParse({
      signedPsbtBase64: 'cHNi',
      rawTxHex: 'deadbeef',
      draftId: 'draft-1',
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: ['rawTxHex'],
        message: 'Provide either signedPsbtBase64 or rawTxHex, not both',
      }),
    ]));
  });

  it('keeps PSBT create explicitly single-recipient', () => {
    expect(MobilePsbtCreateRequestSchema.safeParse({
      recipients: [{ address: 'tb1qrecipient', amount: 10000 }],
      feeRate: 0.5,
    }).success).toBe(true);

    const result = MobilePsbtCreateRequestSchema.safeParse({
      recipients: [
        { address: 'tb1qone', amount: 10000 },
        { address: 'tb1qtwo', amount: 20000 },
      ],
      feeRate: 0.5,
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: ['recipients'],
        message: 'PSBT create supports exactly one recipient; use /transactions/batch for multiple recipients',
      }),
    ]));
  });
});
