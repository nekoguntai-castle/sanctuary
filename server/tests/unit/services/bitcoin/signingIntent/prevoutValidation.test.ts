import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as bitcoin from 'bitcoinjs-lib';

const mocks = vi.hoisted(() => ({
  findByOutpointsForWallet: vi.fn(),
  getTransactionsBatch: vi.fn(),
}));

vi.mock('../../../../../src/repositories/utxoRepository', () => ({
  findByOutpointsForWallet: mocks.findByOutpointsForWallet,
}));
vi.mock('../../../../../src/services/bitcoin/nodeClient', () => ({
  getNodeClient: vi.fn().mockResolvedValue({
    getTransactionsBatch: mocks.getTransactionsBatch,
  }),
}));

import { authenticateIntentPrevouts } from '../../../../../src/services/bitcoin/signingIntent/prevoutValidation';

const script = Buffer.from('0014' + '22'.repeat(20), 'hex');

const previousTransaction = (): bitcoin.Transaction => {
  const tx = new bitcoin.Transaction();
  tx.addInput(Buffer.alloc(32, 1), 0);
  tx.addOutput(script, 10_000n);
  return tx;
};

const psbtFor = (previous: bitcoin.Transaction, witnessScript = script): bitcoin.Psbt => {
  const psbt = new bitcoin.Psbt({ network: bitcoin.networks.testnet });
  psbt.addInput({
    hash: previous.getId(),
    index: 0,
    sequence: 0xfffffffd,
    witnessUtxo: { script: witnessScript, value: 10_000n },
  });
  psbt.addOutput({ script: Buffer.from('0014' + '33'.repeat(20), 'hex'), value: 9_000n });
  return psbt;
};

const walletUtxo = (previous: bitcoin.Transaction, overrides: Record<string, unknown> = {}) => ({
  id: 'utxo-1',
  walletId: 'wallet-1',
  txid: previous.getId(),
  vout: 0,
  amount: 10_000n,
  scriptPubKey: script.toString('hex'),
  spent: false,
  frozen: false,
  draftLock: null,
  ...overrides,
});

describe('signing intent previous-output authentication', () => {
  beforeEach(() => vi.clearAllMocks());

  const arrange = (overrides: Record<string, unknown> = {}) => {
    const previous = previousTransaction();
    mocks.findByOutpointsForWallet.mockResolvedValue([walletUtxo(previous, overrides)]);
    mocks.getTransactionsBatch.mockResolvedValue(new Map([
      [previous.getId(), { hex: previous.toHex() }],
    ]));
    return { previous, psbt: psbtFor(previous) };
  };

  it('requires PSBT, wallet database, and full-node evidence to agree exactly', async () => {
    const { psbt } = arrange();
    await expect(authenticateIntentPrevouts('wallet-1', 'regtest', psbt, ['wallet']))
      .resolves.toEqual([{ amountSats: '10000', scriptPubKeyHex: script.toString('hex'), role: 'wallet' }]);
  });

  it.each([
    ['spent', { spent: true }, 'already-spent'],
    ['frozen', { frozen: true }, 'frozen'],
    ['foreign draft lock', { draftLock: { draftId: 'other-draft' } }, 'locked'],
  ])('rejects %s wallet state', async (_name, overrides, message) => {
    const { psbt } = arrange(overrides);
    await expect(authenticateIntentPrevouts('wallet-1', 'regtest', psbt, ['wallet']))
      .rejects.toThrow(message);
  });

  it('rejects an outpoint absent from the wallet database', async () => {
    const { psbt } = arrange();
    mocks.findByOutpointsForWallet.mockResolvedValue([]);
    await expect(authenticateIntentPrevouts('wallet-1', 'regtest', psbt, ['wallet']))
      .rejects.toThrow('not controlled by the wallet');
  });

  it('rejects missing and mismatched full-node previous transactions', async () => {
    const { previous, psbt } = arrange();
    mocks.getTransactionsBatch.mockResolvedValue(new Map());
    await expect(authenticateIntentPrevouts('wallet-1', 'regtest', psbt, ['wallet']))
      .rejects.toThrow('unavailable');

    const changed = previousTransaction();
    changed.outs[0].value = 9_999n;
    mocks.getTransactionsBatch.mockResolvedValue(new Map([
      [previous.getId(), { hex: changed.toHex() }],
    ]));
    await expect(authenticateIntentPrevouts('wallet-1', 'regtest', psbt, ['wallet']))
      .rejects.toThrow('transaction id does not match');
  });

  it('rejects conflicting witness and non-witness PSBT evidence', async () => {
    const { previous } = arrange();
    const psbt = psbtFor(previous, Buffer.from('0014' + '44'.repeat(20), 'hex'));
    psbt.updateInput(0, { nonWitnessUtxo: previous.toBuffer() });
    await expect(authenticateIntentPrevouts('wallet-1', 'regtest', psbt, ['wallet']))
      .rejects.toThrow('does not match');
  });

  it('allows a spent RBF input only after authenticating the exact replaceable transaction', async () => {
    const { previous, psbt } = arrange({ spent: true });
    const replaced = new bitcoin.Transaction();
    replaced.version = 2;
    replaced.addInput(previous.getHash(), 0, 0xfffffffd);
    replaced.addOutput(Buffer.from('0014' + '55'.repeat(20), 'hex'), 9_500n);
    mocks.getTransactionsBatch.mockResolvedValue(new Map([
      [previous.getId(), { hex: previous.toHex() }],
      [replaced.getId(), { hex: replaced.toHex() }],
    ]));
    await expect(authenticateIntentPrevouts(
      'wallet-1', 'regtest', psbt, ['wallet'], undefined, replaced.getId(),
    )).resolves.toHaveLength(1);

    replaced.ins[0].sequence = 0xffffffff;
    mocks.getTransactionsBatch.mockResolvedValue(new Map([
      [previous.getId(), { hex: previous.toHex() }],
      [replaced.getId(), { hex: replaced.toHex() }],
    ]));
    await expect(authenticateIntentPrevouts(
      'wallet-1', 'regtest', psbt, ['wallet'], undefined, replaced.getId(),
    )).rejects.toThrow('does not signal replacement');

    replaced.ins[0].sequence = 0xfffffffe;
    mocks.getTransactionsBatch.mockResolvedValue(new Map([
      [previous.getId(), { hex: previous.toHex() }],
      [replaced.getId(), { hex: replaced.toHex() }],
    ]));
    await expect(authenticateIntentPrevouts(
      'wallet-1', 'regtest', psbt, ['wallet'], undefined, replaced.getId(),
    )).rejects.toThrow('does not signal replacement');
  });

  it('rejects incomplete role and PSBT previous-output evidence', async () => {
    const { previous, psbt } = arrange();
    await expect(authenticateIntentPrevouts('wallet-1', 'regtest', psbt, []))
      .rejects.toThrow('ownership evidence is incomplete');

    const missingEvidence = new bitcoin.Psbt({ network: bitcoin.networks.testnet });
    missingEvidence.addInput({ hash: previous.getId(), index: 0 });
    missingEvidence.addOutput({ script, value: 9_000n });
    await expect(authenticateIntentPrevouts('wallet-1', 'regtest', missingEvidence, ['wallet']))
      .rejects.toThrow('missing previous-output evidence');
  });

  it('rejects malformed and out-of-range full previous transactions', async () => {
    const { previous, psbt } = arrange();
    mocks.getTransactionsBatch.mockResolvedValueOnce(new Map([
      [previous.getId(), { hex: '00' }],
    ]));
    await expect(authenticateIntentPrevouts('wallet-1', 'regtest', psbt, ['wallet']))
      .rejects.toThrow('malformed');

    const missingOutput = new bitcoin.Psbt({ network: bitcoin.networks.testnet });
    missingOutput.addInput({
      hash: previous.getId(),
      index: 9,
      nonWitnessUtxo: previous.toBuffer(),
    });
    missingOutput.addOutput({ script, value: 9_000n });
    await expect(authenticateIntentPrevouts('wallet-1', 'regtest', missingOutput, ['wallet']))
      .rejects.toThrow('output does not exist');
  });

  it.each([
    (hex: string) => `${hex}zz`,
    (hex: string) => hex.slice(0, -1),
    (hex: string) => ` ${hex}`,
    (hex: string) => `${hex.slice(0, 8)}zz${hex.slice(10)}`,
  ])('rejects non-canonical node transaction hex', async (mutate) => {
    const { previous, psbt } = arrange();
    mocks.getTransactionsBatch.mockResolvedValueOnce(new Map([
      [previous.getId(), { hex: mutate(previous.toHex()) }],
    ]));
    await expect(authenticateIntentPrevouts('wallet-1', 'regtest', psbt, ['wallet']))
      .rejects.toThrow('malformed');
  });

  it('accepts uppercase full node transaction hex', async () => {
    const { previous, psbt } = arrange();
    mocks.getTransactionsBatch.mockResolvedValueOnce(new Map([
      [previous.getId(), { hex: previous.toHex().toUpperCase() }],
    ]));
    await expect(authenticateIntentPrevouts('wallet-1', 'regtest', psbt, ['wallet']))
      .resolves.toHaveLength(1);
  });

  it('fails closed when the node preflight lookup fails', async () => {
    const { psbt } = arrange();
    mocks.getTransactionsBatch.mockRejectedValueOnce(new Error('node offline'));
    await expect(authenticateIntentPrevouts('wallet-1', 'regtest', psbt, ['wallet']))
      .rejects.toThrow('Could not authenticate');
  });

  it('requires an available replacement with the exact original input order', async () => {
    const { previous, psbt } = arrange({ spent: true });
    await expect(authenticateIntentPrevouts(
      'wallet-1', 'regtest', psbt, ['wallet'], undefined, 'f'.repeat(64),
    )).rejects.toThrow('Replaced transaction is unavailable');

    const replaced = new bitcoin.Transaction();
    replaced.addInput(Buffer.alloc(32, 9), 4, 0xfffffffd);
    replaced.addOutput(script, 9_000n);
    mocks.getTransactionsBatch.mockResolvedValueOnce(new Map([
      [previous.getId(), { hex: previous.toHex() }],
      [replaced.getId(), { hex: replaced.toHex() }],
    ]));
    await expect(authenticateIntentPrevouts(
      'wallet-1', 'regtest', psbt, ['wallet'], undefined, replaced.getId(),
    )).rejects.toThrow('Replacement inputs do not match');
  });

  it.each([
    (hex: string) => `${hex}zz`,
    (hex: string) => hex.slice(0, -1),
    (hex: string) => ` ${hex}`,
  ])('rejects non-canonical replacement transaction hex', async (mutate) => {
    const { previous, psbt } = arrange({ spent: true });
    const replaced = new bitcoin.Transaction();
    replaced.addInput(previous.getHash(), 0, 0xfffffffd);
    replaced.addOutput(script, 9_000n);
    mocks.getTransactionsBatch.mockResolvedValueOnce(new Map([
      [previous.getId(), { hex: previous.toHex() }],
      [replaced.getId(), { hex: mutate(replaced.toHex()) }],
    ]));

    await expect(authenticateIntentPrevouts(
      'wallet-1', 'regtest', psbt, ['wallet'], undefined, replaced.getId(),
    )).rejects.toThrow('malformed');
  });
});
