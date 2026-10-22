import * as bitcoin from 'bitcoinjs-lib';
import { describe, expect, it, vi } from 'vitest';
import {
  createTestContext,
  receiveEvidenceGatePhase,
} from '../../../../../src/services/bitcoin/sync';
import type { RawTransaction } from '../../../../../src/services/bitcoin/sync';
import {
  fetchCompactAuthenticatedTransactions,
  MAX_AUTHENTICATED_INPUTS_PER_ATTEMPT,
  MAX_AUTHENTICATED_INPUTS_PER_TRANSACTION,
  MAX_AUTHENTICATED_OUTPUTS_PER_ATTEMPT,
  MAX_AUTHENTICATED_OUTPUTS_PER_TRANSACTION,
  MAX_AUTHENTICATED_RAW_HEX_CHARS_PER_ATTEMPT,
} from '../../../../../src/services/bitcoin/sync/evidenceAuthentication';
import { authenticateHistoryResults } from '../../../../../src/services/bitcoin/sync/historyEvidenceAuthentication';

const { evidenceLog } = vi.hoisted(() => ({
  evidenceLog: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../../../../../src/utils/logger', () => ({ createLogger: () => evidenceLog }));

// Run the compact projector in-process: the ceiling under test lives in the
// main-isolate accounting, not in the worker transport.
vi.mock('../../../../../src/services/bitcoin/sync/transactionEvidenceThread', async () => {
  const actual = await vi.importActual<typeof import(
    '../../../../../src/services/bitcoin/sync/transactionEvidenceThread'
  )>('../../../../../src/services/bitcoin/sync/transactionEvidenceThread');
  const projection = await import(
    '../../../../../src/services/bitcoin/sync/transactionEvidenceProjection'
  );
  const sealed = (envelope: any) => ({
    expectedTxid: envelope.txid,
    canonicalBytes: envelope.canonicalBytes,
    digest: envelope.digest,
    complexity: envelope.complexity,
    metadata: envelope.metadata,
  });
  return {
    ...actual,
    createCompactTransactionEvidenceProjector: (walletScripts: readonly string[]) => ({
      projectCompact: async (input: any) => projection.projectCompactAuthenticatedTransaction({
        expectedTxid: input.expectedTxid,
        remoteTxid: input.details.txid,
        canonicalBytes: Uint8Array.from(Buffer.from(input.details.hex ?? '', 'hex')),
        metadata: {},
        limits: input.limits,
      }, walletScripts),
      projectFull: async (envelope: any) => projection.reprojectFullAuthenticatedTransaction(sealed(envelope)),
      extractOutputs: async (envelope: any, vouts: readonly number[]) => (
        projection.extractExactAuthenticatedTransactionOutputs(sealed(envelope), vouts)
      ),
      close: async () => undefined,
    }),
  };
});

const payment = bitcoin.payments.p2wpkh({
  pubkey: Buffer.from(`02${'44'.repeat(32)}`, 'hex'),
  network: bitcoin.networks.testnet,
});
const walletScript = Buffer.from(payment.output!).toString('hex');

/** A coinbase-funded batch payout: `outputCount - 1` one-byte outputs plus one wallet output. */
const batchPayout = (ordinal: number, outputCount: number): RawTransaction => {
  const transaction = new bitcoin.Transaction();
  transaction.version = 2;
  transaction.locktime = ordinal;
  transaction.addInput(new Uint8Array(32), 0xffffffff, 0xffffffff, Buffer.from([1, ordinal & 0xff]));
  const external = Uint8Array.from([0x51]);
  for (let index = 0; index < outputCount - 1; index += 1) transaction.addOutput(external, 1n);
  transaction.addOutput(payment.output!, 1_000n);
  return { txid: transaction.getId(), hex: transaction.toHex(), vin: [], vout: [] };
};

const contextFor = (transactions: RawTransaction[]) => {
  const byTxid = new Map(transactions.map(details => [details.txid, details]));
  const address = {
    id: 'address-id', walletId: 'wallet-id', address: payment.address!,
    derivationPath: "m/84'/1'/0'/0/0", index: 0, branch: 0, coordinateVersion: 1,
    canonicalPolicyId: 'single_sig_native_segwit', canonicalPolicyVersion: 1,
    scriptPubKey: walletScript, used: false, createdAt: new Date(),
  };
  return createTestContext({
    walletId: 'wallet-id',
    network: 'testnet3',
    addresses: [address] as any,
    addressMap: new Map([[address.address, address]]) as any,
    walletAddressSet: new Set([address.address]),
    walletScriptToAddress: new Map([[walletScript, address]]) as any,
    historyResults: new Map([[address.address, transactions.map((details, index) => ({
      tx_hash: details.txid, height: 100 + index,
    }))]]),
    client: {
      getTransactionsBatch: vi.fn(async (txids: string[]) => new Map(
        txids.flatMap(txid => byTxid.has(txid) ? [[txid, byTxid.get(txid)!] as const] : []),
      )),
      getTransaction: vi.fn(async (txid: string) => byTxid.get(txid)),
    } as any,
  });
};

describe('per-attempt history evidence ceiling', () => {
  it('authenticates a whole history whose summed outputs exceed the output-scan ceiling while its retained bytes fit', async () => {
    const perTransaction = MAX_AUTHENTICATED_OUTPUTS_PER_TRANSACTION;
    const count = Math.floor(MAX_AUTHENTICATED_OUTPUTS_PER_ATTEMPT / perTransaction) + 1;
    const history = Array.from({ length: count }, (_, index) => batchPayout(index + 1, perTransaction));
    const ctx = contextFor(history);

    await authenticateHistoryResults(ctx);

    const totalOutputs = [...ctx.authenticatedTransactionEvidence.values()]
      .reduce((sum, envelope) => sum + envelope.complexity.outputs, 0);
    const retainedHex = [...ctx.authenticatedTransactionEvidence.values()]
      .reduce((sum, envelope) => sum + envelope.canonicalBytes.byteLength * 2, 0);
    expect(ctx.rejectedEvidenceReasons).toEqual(new Map());
    expect(ctx.allTxids).toEqual(new Set(history.map(details => details.txid)));
    expect(totalOutputs).toBeGreaterThan(MAX_AUTHENTICATED_OUTPUTS_PER_ATTEMPT);
    expect(retainedHex).toBeLessThan(MAX_AUTHENTICATED_RAW_HEX_CHARS_PER_ATTEMPT);
    await expect(receiveEvidenceGatePhase(ctx)).resolves.toBe(ctx);
  }, 60_000);

  it('still refuses one transaction beyond the per-transaction output limit', async () => {
    const oversized = batchPayout(1, MAX_AUTHENTICATED_OUTPUTS_PER_TRANSACTION + 1);
    const ctx = contextFor([oversized]);

    await expect(fetchCompactAuthenticatedTransactions(ctx, [oversized.txid]))
      .resolves.toEqual(new Set());
    expect(ctx.authenticatedTransactionEvidence.has(oversized.txid)).toBe(false);
    expect(ctx.rejectedEvidenceReasons).toEqual(new Map([['transaction_complexity_exceeded', 1]]));
  });

  const seedResident = (ctx: ReturnType<typeof contextFor>, rawHexChars: number, inputs = 0) => {
    const resident = batchPayout(99, 2);
    ctx.authenticatedTransactionEvidence.set(resident.txid, {
      txid: resident.txid,
      canonicalBytes: new Uint8Array(0),
      digest: '00'.repeat(32),
      complexity: { rawHexChars, inputs, outputs: 0, scriptHexChars: 0 },
      metadata: {},
      inputTxids: new Uint8Array(0),
      inputVouts: new Uint32Array(0),
      paidWalletScriptIndexes: new Uint32Array(0),
    });
  };

  it('reports the attempt capacity limit once retained canonical bytes reach the attempt ceiling', async () => {
    const next = batchPayout(2, 2);
    const after = batchPayout(3, 2);
    const ctx = contextFor([next, after]);
    seedResident(ctx, MAX_AUTHENTICATED_RAW_HEX_CHARS_PER_ATTEMPT - next.hex!.length + 1);
    evidenceLog.error.mockClear();

    await expect(fetchCompactAuthenticatedTransactions(ctx, [next.txid, after.txid]))
      .resolves.toEqual(new Set());
    expect(ctx.rejectedEvidenceReasons).toEqual(new Map([['attempt_evidence_capacity_exceeded', 2]]));
    expect(evidenceLog.error).toHaveBeenCalledTimes(1);
    expect(evidenceLog.error).toHaveBeenCalledWith(
      expect.stringContaining('per-attempt authenticated evidence capacity'),
      expect.objectContaining({ walletId: 'wallet-id' }),
    );
    await expect(receiveEvidenceGatePhase(ctx)).rejects.toThrow('attempt_evidence_capacity_exceeded x 2');
  });

  it('keeps the per-transaction label when the attempt remainder is not binding', async () => {
    const oversized = batchPayout(1, MAX_AUTHENTICATED_OUTPUTS_PER_TRANSACTION + 1);
    const ctx = contextFor([oversized]);
    seedResident(ctx, 1_000);

    await expect(fetchCompactAuthenticatedTransactions(ctx, [oversized.txid]))
      .resolves.toEqual(new Set());
    expect(ctx.rejectedEvidenceReasons).toEqual(new Map([['transaction_complexity_exceeded', 1]]));
  });

  it.each([
    ['transaction_complexity_exceeded', 0],
    ['attempt_evidence_capacity_exceeded', 1],
  ])('labels a refusal %s at the attempt input remainder boundary +%i', async (label, over) => {
    const oversized = batchPayout(5, MAX_AUTHENTICATED_OUTPUTS_PER_TRANSACTION + 1);
    const ctx = contextFor([oversized]);
    seedResident(
      ctx,
      1_000,
      MAX_AUTHENTICATED_INPUTS_PER_ATTEMPT - MAX_AUTHENTICATED_INPUTS_PER_TRANSACTION + over,
    );

    await expect(fetchCompactAuthenticatedTransactions(ctx, [oversized.txid]))
      .resolves.toEqual(new Set());
    expect(ctx.rejectedEvidenceReasons).toEqual(new Map([[label, 1]]));
  });

  it('keeps the per-transaction label for one raw transaction larger than the whole attempt', async () => {
    const huge = { ...batchPayout(4, 2), hex: { length: MAX_AUTHENTICATED_RAW_HEX_CHARS_PER_ATTEMPT + 2 } as string };
    const ctx = contextFor([huge]);
    evidenceLog.error.mockClear();

    await expect(fetchCompactAuthenticatedTransactions(ctx, [huge.txid]))
      .resolves.toEqual(new Set());
    expect(ctx.rejectedEvidenceReasons).toEqual(new Map([['transaction_complexity_exceeded', 1]]));
    expect(evidenceLog.error).not.toHaveBeenCalled();
  });
});
