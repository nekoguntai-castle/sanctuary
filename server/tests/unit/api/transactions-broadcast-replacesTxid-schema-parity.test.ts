/**
 * Contract test: the two broadcast request schemas that the transaction and
 * PSBT broadcast routes validate against (both defined in the shared schema
 * package and consumed as-is by the gateway and the backend route) must
 * accept and reject `replacesTxid` the same way, and must actually enforce
 * the 64-character lowercase-hex txid format rather than silently accepting
 * (and dropping) anything sent under that key. A gap here means one
 * broadcast path could route a request through that the other path would
 * reject as malformed, or that a malformed `replacesTxid` is accepted
 * instead of rejected. See iteration-18 plan Phase 5
 * (rbf-memo-prefix-spoofs-transaction-replacement), and the push-register
 * parity test (#1110) this follows the shape of.
 */
import { describe, expect, it } from 'vitest';

import {
  MobilePsbtBroadcastRequestSchema,
  MobileTransactionBroadcastRequestSchema,
} from '@sanctuary/shared/schemas/mobileApiRequests';

const validSignedPsbtBase64 = 'cHNi';
const validIntentId = 'intent-1';
const validIntentDigest = 'a'.repeat(64);

const baseTransactionBody = {
  signedPsbtBase64: validSignedPsbtBase64,
  intentId: validIntentId,
  intentDigest: validIntentDigest,
};

const basePsbtBody = {
  signedPsbt: validSignedPsbtBase64,
  intentId: validIntentId,
  intentDigest: validIntentDigest,
};

const replacesTxidShapes: Array<{ label: string; replacesTxid: unknown; expectAccepted: boolean }> = [
  { label: 'undefined (omitted)', replacesTxid: undefined, expectAccepted: true },
  { label: 'a valid lowercase 64-hex txid', replacesTxid: 'a'.repeat(64), expectAccepted: true },
  { label: 'an uppercase 64-hex txid', replacesTxid: 'A'.repeat(64), expectAccepted: false },
  { label: 'a 63-hex-character string (too short)', replacesTxid: 'a'.repeat(63), expectAccepted: false },
  { label: 'a 65-hex-character string (too long)', replacesTxid: 'a'.repeat(65), expectAccepted: false },
  { label: 'a non-hex string of the right length', replacesTxid: 'z'.repeat(64), expectAccepted: false },
  { label: 'an empty string', replacesTxid: '', expectAccepted: false },
  { label: 'a number', replacesTxid: 12345, expectAccepted: false },
  { label: 'null', replacesTxid: null, expectAccepted: false },
];

describe('broadcast request replacesTxid contract parity', () => {
  it.each(replacesTxidShapes)(
    'accepts/rejects $label the same way in both broadcast schemas',
    ({ replacesTxid, expectAccepted }) => {
      const transactionBody: Record<string, unknown> = { ...baseTransactionBody };
      const psbtBody: Record<string, unknown> = { ...basePsbtBody };
      if (replacesTxid !== undefined) {
        transactionBody.replacesTxid = replacesTxid;
        psbtBody.replacesTxid = replacesTxid;
      }

      const transactionResult = MobileTransactionBroadcastRequestSchema.safeParse(transactionBody);
      const psbtResult = MobilePsbtBroadcastRequestSchema.safeParse(psbtBody);

      expect(transactionResult.success).toBe(expectAccepted);
      expect(psbtResult.success).toBe(expectAccepted);
    },
  );

  it('is optional on both broadcast schemas', () => {
    expect(MobileTransactionBroadcastRequestSchema.safeParse(baseTransactionBody).success).toBe(true);
    expect(MobilePsbtBroadcastRequestSchema.safeParse(basePsbtBody).success).toBe(true);
  });
});
