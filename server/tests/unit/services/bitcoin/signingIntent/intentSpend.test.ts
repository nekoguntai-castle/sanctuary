import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as bitcoin from 'bitcoinjs-lib';

const mocks = vi.hoisted(() => ({ findAddressStrings: vi.fn() }));
vi.mock('../../../../../src/repositories/addressRepository', () => ({
  addressRepository: { findAddressStrings: mocks.findAddressStrings },
}));

import { deriveIntentSpend } from '../../../../../src/services/bitcoin/signingIntent/intentSpend';
import type { SigningIntentSnapshotV1 } from '../../../../../src/services/bitcoin/signingIntent/types';

const p2wpkh = (fill: number) => {
  const payment = bitcoin.payments.p2wpkh({ hash: Buffer.alloc(20, fill), network: bitcoin.networks.testnet });
  return { address: payment.address!, script: Buffer.from(payment.output!).toString('hex') };
};
const walletInput = p2wpkh(1);
const change = p2wpkh(2);
const recipient = p2wpkh(3);
const otherRecipient = p2wpkh(4);

const snapshot = (
  outputs: Array<{ amountSats: string; scriptPubKeyHex: string }>,
  replacementTxid?: string,
): SigningIntentSnapshotV1 => ({
  version: 1,
  walletId: 'wallet-1',
  network: 'testnet3',
  transaction: {
    version: 2,
    locktime: 0,
    ...(replacementTxid && { replacementTxid }),
    inputs: [{
      txid: 'a'.repeat(64), vout: 1, sequence: 0xfffffffd,
      prevout: { amountSats: '100000', scriptPubKeyHex: walletInput.script, role: 'wallet' },
    }],
    outputs,
  },
});

describe('deriveIntentSpend', () => {
  beforeEach(() => {
    mocks.findAddressStrings.mockClear();
    mocks.findAddressStrings.mockResolvedValue([walletInput.address, change.address]);
  });

  it('derives external outputs and their sum from the snapshot and the wallet addresses', async () => {
    const spend = await deriveIntentSpend('wallet-1', 'testnet3', snapshot([
      { amountSats: '40000', scriptPubKeyHex: recipient.script },
      { amountSats: '25000', scriptPubKeyHex: otherRecipient.script },
      { amountSats: '34000', scriptPubKeyHex: change.script },
      { amountSats: '0', scriptPubKeyHex: '6a0101' },
    ]));

    expect(mocks.findAddressStrings).toHaveBeenCalledWith('wallet-1');
    expect(spend.externalOutputs).toEqual([
      { address: recipient.address, amount: 40000 },
      { address: otherRecipient.address, amount: 25000 },
    ]);
    expect(spend.amount).toBe(65000);
    expect(spend.inputs).toEqual([{ txid: 'a'.repeat(64), vout: 1, address: walletInput.address, amount: 100000 }]);
    expect(spend.outputs.map(output => output.outputType)).toEqual(['recipient', 'recipient', 'change', 'unknown']);
    expect(spend).not.toHaveProperty('replacementTxid');
  });

  it('carries the authenticated replacement txid', async () => {
    const spend = await deriveIntentSpend('wallet-1', 'testnet3', snapshot(
      [{ amountSats: '1000', scriptPubKeyHex: recipient.script }],
      'b'.repeat(64),
    ));
    expect(spend.replacementTxid).toBe('b'.repeat(64));
  });

  it('reports a pure self-transfer as spending nothing', async () => {
    const spend = await deriveIntentSpend('wallet-1', 'testnet3', snapshot([
      { amountSats: '99000', scriptPubKeyHex: change.script },
    ]));
    expect(spend.externalOutputs).toEqual([]);
    expect(spend.amount).toBe(0);
  });

  it('uses a preloaded wallet address set instead of querying it', async () => {
    const spend = await deriveIntentSpend('wallet-1', 'testnet3', snapshot([
      { amountSats: '40000', scriptPubKeyHex: recipient.script },
      { amountSats: '59000', scriptPubKeyHex: change.script },
    ]), new Set([walletInput.address, recipient.address]));

    expect(mocks.findAddressStrings).not.toHaveBeenCalled();
    // The preloaded set is authoritative: here the recipient is treated as ours.
    expect(spend.externalOutputs).toEqual([{ address: change.address, amount: 59000 }]);
    expect(spend.amount).toBe(59000);
  });

  it('fails closed on a paid output with no decodable address', async () => {
    await expect(deriveIntentSpend('wallet-1', 'testnet3', snapshot([
      { amountSats: '1', scriptPubKeyHex: '6a0101' },
    ]))).rejects.toMatchObject({ details: expect.objectContaining({ reason: 'unsupported_script' }) });
  });

  const withPeerInputs = (
    peerAmounts: string[],
    outputs: Array<{ amountSats: string; scriptPubKeyHex: string }>,
  ): SigningIntentSnapshotV1 => {
    const base = snapshot(outputs);
    return {
      ...base,
      transaction: {
        ...base.transaction,
        inputs: [
          ...base.transaction.inputs,
          ...peerAmounts.map((amountSats, index) => ({
            txid: 'c'.repeat(64), vout: index, sequence: 0xfffffffd,
            prevout: { amountSats, scriptPubKeyHex: otherRecipient.script, role: 'payjoin_peer' as const },
          })),
        ],
      },
    };
  };

  it('nets a payjoin receiver contribution out of the sender spend', async () => {
    // BIP78: the receiver adds input C and raises its output from P to P + C.
    const spend = await deriveIntentSpend('wallet-1', 'testnet3', withPeerInputs(['15000'], [
      { amountSats: '55000', scriptPubKeyHex: recipient.script },
      { amountSats: '59000', scriptPubKeyHex: change.script },
    ]));
    expect(spend.amount).toBe(40000);
    expect(spend.externalOutputs).toEqual([{ address: recipient.address, amount: 55000 }]);
    expect(spend.inputs).toHaveLength(2);
  });

  it('nets every payjoin peer input out of the sender spend', async () => {
    const spend = await deriveIntentSpend('wallet-1', 'testnet3', withPeerInputs(['10000', '5000'], [
      { amountSats: '55000', scriptPubKeyHex: recipient.script },
      { amountSats: '59000', scriptPubKeyHex: change.script },
    ]));
    expect(spend.amount).toBe(40000);
  });

  it('floors the net sender spend at zero', async () => {
    const spend = await deriveIntentSpend('wallet-1', 'testnet3', withPeerInputs(['70000'], [
      { amountSats: '55000', scriptPubKeyHex: recipient.script },
      { amountSats: '114000', scriptPubKeyHex: change.script },
    ]));
    expect(spend.amount).toBe(0);
    expect(spend.externalOutputs).toEqual([{ address: recipient.address, amount: 55000 }]);
  });

  it.each(['-1', '1.5', String(Number.MAX_SAFE_INTEGER + 2)])('rejects the unsafe amount %s', async (value) => {
    await expect(deriveIntentSpend('wallet-1', 'testnet3', snapshot([
      { amountSats: value, scriptPubKeyHex: recipient.script },
    ]))).rejects.toThrow('Signing intent amount is invalid');
  });
});
