import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as bitcoin from 'bitcoinjs-lib';

import { mockPrismaClient, resetPrismaMocks } from '../../../mocks/prisma';

vi.mock('../../../../src/models/prisma', () => ({
  default: mockPrismaClient,
}));

import {
  assertExactUtxoSelection,
  selectUTXOsExact,
  type ExactSelectionFeeContext,
} from '../../../../src/services/bitcoin/utxoSelection';
import { selectUtxosForMode } from '../../../../src/services/bitcoin/transactions/utxoModes';
import { estimateTransactionWeight, feeForRate, type TransactionWeightInput } from '../../../../src/services/bitcoin/transactionWeight';
import { parseMultisigScript } from '../../../../src/services/bitcoin/psbtBuilder';
import { GENERATED_SIGNED_PSBT_VECTORS } from '../../../fixtures/generated-signed-psbt-vectors';

const P2PKH = `76a914${'11'.repeat(20)}88ac`;
const P2WPKH = `0014${'22'.repeat(20)}`;
const P2TR = `5120${'33'.repeat(32)}`;

const p2pkhContext = (recipientScript: string, changeScript = P2WPKH): ExactSelectionFeeContext => ({
  resolveSpendPolicies: async utxos => new Map(utxos.map(utxo => [utxo.address, { spendPolicy: { type: 'p2pkh' as const } }])),
  recipientScript: Buffer.from(recipientScript, 'hex'),
  changeScripts: [Buffer.from(changeScript, 'hex')],
  dustThreshold: 546,
});

const p2wpkhContext = (recipientScript: string, changeScript = P2WPKH): ExactSelectionFeeContext => ({
  resolveSpendPolicies: async utxos => new Map(utxos.map(utxo => [utxo.address, { spendPolicy: { type: 'p2wpkh' as const } }])),
  recipientScript: Buffer.from(recipientScript, 'hex'),
  changeScripts: [Buffer.from(changeScript, 'hex')],
  dustThreshold: 546,
});

interface UtxoFixture {
  id: string;
  txid: string;
  vout: number;
  amount: bigint;
  address: string;
  scriptPubKey: string;
  confirmations: number;
  spent: boolean;
  frozen: boolean;
  walletId: string;
  draftLock: null;
}

function utxo(id: string, amount: number, scriptPubKey: string): UtxoFixture {
  return {
    id,
    txid: id.padEnd(64, id[0] ?? 'a').slice(0, 64),
    vout: 0,
    amount: BigInt(amount),
    address: `address-${id}`,
    scriptPubKey,
    confirmations: 6,
    spent: false,
    frozen: false,
    walletId: 'wallet-1',
    draftLock: null,
  };
}

function mockAvailable(utxos: UtxoFixture[]): void {
  mockPrismaClient.uTXO.findMany.mockResolvedValueOnce(utxos);
}

function coreVectorInput(
  vector: (typeof GENERATED_SIGNED_PSBT_VECTORS)[number],
  psbt: bitcoin.Psbt,
): TransactionWeightInput {
  const data = psbt.data.inputs[0];
  const previous = data.witnessUtxo ?? (() => {
    const transaction = bitcoin.Transaction.fromBuffer(data.nonWitnessUtxo!);
    return transaction.outs[psbt.txInputs[0].index];
  })();
  const prevoutScript = previous.script;
  if (vector.scriptType === 'p2pkh') return { spendPolicy: { type: 'p2pkh' }, prevoutScript };
  if (vector.scriptType === 'p2wpkh') return { spendPolicy: { type: 'p2wpkh' }, prevoutScript };
  if (vector.scriptType === 'p2sh-p2wpkh') {
    return { spendPolicy: { type: 'p2sh-p2wpkh' }, prevoutScript, redeemScript: data.redeemScript! };
  }
  if (vector.scriptType === 'p2tr') return { spendPolicy: { type: 'p2tr-keypath' }, prevoutScript };
  const parsed = parseMultisigScript(data.witnessScript!);
  if (!parsed.isMultisig) throw new Error('Core vector witness script is not multisig');
  if (vector.scriptType === 'p2wsh') {
    return { spendPolicy: { type: 'p2wsh-sortedmulti', m: parsed.m, n: parsed.n }, prevoutScript, witnessScript: data.witnessScript! };
  }
  return {
    spendPolicy: { type: 'p2sh-p2wsh-sortedmulti', m: parsed.m, n: parsed.n },
    prevoutScript,
    redeemScript: data.redeemScript!,
    witnessScript: data.witnessScript!,
  };
}

describe('exact transaction selection boundaries', () => {
  beforeEach(() => {
    resetPrismaMocks();
    mockPrismaClient.systemSetting.findUnique.mockResolvedValue(null);
  });

  it('treats omitted coin control as unrestricted', () => {
    expect(() => assertExactUtxoSelection([], undefined)).not.toThrow();
  });

  it('rejects an empty exact spend set', async () => {
    mockAvailable([]);
    await expect(selectUTXOsExact('wallet-1', 10_000, 2, p2wpkhContext(P2WPKH)))
      .rejects.toThrow('No spendable UTXOs available');
  });

  it('honors a valid explicit exact-selection outpoint', async () => {
    const first = utxo('a', 20_000, P2WPKH);
    const selected = utxo('b', 30_000, P2WPKH);
    mockAvailable([first, selected]);

    const result = await selectUTXOsExact(
      'wallet-1', 10_000, 2, p2wpkhContext(P2WPKH),
      [`${selected.txid}:${selected.vout}`],
    );

    expect(result.utxos.map(({ id }) => id)).toEqual(['b']);
  });

  it('does not stop after the concrete legacy input that the former native-SegWit estimate underfunded', async () => {
    mockAvailable([
      utxo('a', 12_000, P2PKH),
      utxo('b', 5_000, P2PKH),
    ]);

    const result = await selectUTXOsExact(
      'wallet-1',
      10_000,
      10,
      p2pkhContext(P2TR),
    );

    // The removed approximation charged 1,465 sats for one native-SegWit
    // input and two generic outputs, so it incorrectly accepted the 12,000
    // sat coin. The exact legacy spend needs 2,020 sats even without change.
    expect(result.utxos.map(({ id }) => id)).toEqual(['a', 'b']);
    expect(result).toMatchObject({
      totalAmount: 17_000,
      estimatedFee: 3_820,
      changeAmount: 3_180,
    });
  });

  it('moves from absorbed dust to exact change at the one-satoshi boundary', async () => {
    mockAvailable([utxo('a', 10_851, P2WPKH)]);
    const dust = await selectUTXOsExact(
      'wallet-1',
      10_000,
      2,
      p2wpkhContext(P2TR),
    );

    expect(dust).toMatchObject({
      estimatedFee: 851,
      changeAmount: 0,
    });

    mockAvailable([utxo('b', 10_852, P2WPKH)]);
    const change = await selectUTXOsExact(
      'wallet-1',
      10_000,
      2,
      p2wpkhContext(P2TR),
    );

    expect(change).toMatchObject({
      estimatedFee: 306,
      changeAmount: 546,
    });
  });

  it('accepts exact no-change coverage and reports the exact one-satoshi shortfall', async () => {
    const noChangeContext = p2wpkhContext(P2WPKH);
    noChangeContext.changeScripts = [];
    mockAvailable([utxo('a', 10_110, P2WPKH)]);

    const exact = await selectUTXOsExact('wallet-1', 10_000, 1, noChangeContext);
    expect(exact).toMatchObject({
      totalAmount: 10_110,
      estimatedFee: 110,
      changeAmount: 0,
      feeSurplusSats: 0,
    });

    mockAvailable([utxo('b', 10_109, P2WPKH)]);
    await expect(selectUTXOsExact('wallet-1', 10_000, 1, noChangeContext))
      .rejects.toThrow('Insufficient funds. Need 10110 sats, have 10109 sats');
  });

  it('absorbs surplus into the fee when no change script is authorized', async () => {
    const noChangeContext = p2wpkhContext(P2WPKH);
    noChangeContext.changeScripts = [];
    mockAvailable([utxo('a', 11_110, P2WPKH)]);

    const result = await selectUTXOsExact('wallet-1', 10_000, 1, noChangeContext);

    expect(result).toMatchObject({
      totalAmount: 11_110,
      estimatedFee: 1_110,
      changeAmount: 0,
      changeOutputCount: 0,
      feeSurplusSats: 1_000,
    });
  });

  it('uses recipient and change script sizes when deciding whether change survives', async () => {
    mockAvailable([utxo('a', 10_828, P2WPKH)]);
    const compactOutputs = await selectUTXOsExact(
      'wallet-1',
      10_000,
      2,
      p2wpkhContext(P2WPKH, P2WPKH),
    );

    expect(compactOutputs).toMatchObject({
      estimatedFee: 282,
      changeAmount: 546,
    });

    mockAvailable([utxo('b', 10_828, P2WPKH)]);
    const largerRecipient = await selectUTXOsExact(
      'wallet-1',
      10_000,
      2,
      p2wpkhContext(P2TR, P2WPKH),
    );
    expect(largerRecipient).toMatchObject({
      estimatedFee: 828,
      changeAmount: 0,
    });

    mockAvailable([utxo('c', 10_828, P2WPKH)]);
    const largerChange = await selectUTXOsExact(
      'wallet-1',
      10_000,
      2,
      p2wpkhContext(P2WPKH, P2TR),
    );
    expect(largerChange).toMatchObject({
      estimatedFee: 828,
      changeAmount: 0,
    });
  });

  it('subtract-fee conserves the input across dust absorption and exact change', async () => {
    mockAvailable([utxo('a', 10_545, P2WPKH)]);
    const dust = await selectUtxosForMode(
      'wallet-1',
      10_000,
      2,
      546,
      false,
      true,
      p2wpkhContext(P2WPKH),
    );

    expect(dust.effectiveAmount).toBe(9_780);
    expect(dust.selection).toMatchObject({ estimatedFee: 765, changeAmount: 0 });
    expect(dust.effectiveAmount + dust.selection.estimatedFee).toBe(10_545);

    mockAvailable([utxo('b', 10_546, P2WPKH)]);
    const change = await selectUtxosForMode(
      'wallet-1',
      10_000,
      2,
      546,
      false,
      true,
      p2wpkhContext(P2WPKH),
    );

    expect(change.effectiveAmount).toBe(9_718);
    expect(change.selection).toMatchObject({ estimatedFee: 282, changeAmount: 546 });
    expect(
      change.effectiveAmount + change.selection.changeAmount + change.selection.estimatedFee,
    ).toBe(10_546);
  });

  it('send-max reduces the recipient by the exact recipient script cost', async () => {
    mockAvailable([utxo('a', 10_000, P2WPKH)]);
    const p2wpkh = await selectUtxosForMode(
      'wallet-1',
      0,
      2,
      546,
      true,
      false,
      p2wpkhContext(P2WPKH),
    );

    mockAvailable([utxo('b', 10_000, P2WPKH)]);
    const p2tr = await selectUtxosForMode(
      'wallet-1',
      0,
      2,
      546,
      true,
      false,
      p2wpkhContext(P2TR),
    );

    expect(p2wpkh).toMatchObject({
      effectiveAmount: 9_780,
      selection: { estimatedFee: 220, changeAmount: 0 },
    });
    expect(p2tr).toMatchObject({
      effectiveAmount: 9_756,
      selection: { estimatedFee: 244, changeAmount: 0 },
    });
  });

  it('fails closed when explicit coin control contains an unavailable or duplicate outpoint', async () => {
    const available = utxo('a', 20_000, P2WPKH);
    const availableId = `${available.txid}:${available.vout}`;
    mockAvailable([available]);
    await expect(selectUTXOsExact(
      'wallet-1', 10_000, 2, p2wpkhContext(P2WPKH), [availableId, `${'f'.repeat(64)}:1`],
    )).rejects.toThrow('Selected UTXOs are unavailable');

    mockAvailable([available]);
    await expect(selectUTXOsExact(
      'wallet-1', 10_000, 2, p2wpkhContext(P2WPKH), [availableId, availableId],
    )).rejects.toThrow('must be unique');
  });

  it('records a single-output decoy fallback so construction cannot re-enable extra outputs', async () => {
    const context = p2wpkhContext(P2WPKH);
    context.changeScripts = [
      Buffer.from(P2WPKH, 'hex'),
      Buffer.from(P2WPKH, 'hex'),
      Buffer.from(P2WPKH, 'hex'),
      Buffer.from(P2WPKH, 'hex'),
    ];
    mockAvailable([utxo('a', 12_500, P2WPKH)]);
    const result = await selectUTXOsExact('wallet-1', 10_000, 5, context);
    expect(result).toMatchObject({ changeOutputCount: 1 });
  });

  it('uses the inclusive dust boundary for a single-output decoy fallback', async () => {
    const context = p2wpkhContext(P2WPKH);
    context.changeScripts = Array.from({ length: 4 }, () => Buffer.from(P2WPKH, 'hex'));
    const singleChangeFee = feeForRate(estimateTransactionWeight({
      inputs: [{ spendPolicy: { type: 'p2wpkh' }, prevoutScript: Buffer.from(P2WPKH, 'hex') }],
      outputs: [context.recipientScript, context.changeScripts[0]].map(scriptPubKey => ({ scriptPubKey })),
    }).vsize, 2);
    mockAvailable([utxo('a', 10_000 + singleChangeFee + 546, P2WPKH)]);

    const exactDust = await selectUTXOsExact('wallet-1', 10_000, 2, context);

    expect(exactDust).toMatchObject({
      estimatedFee: singleChangeFee,
      changeAmount: 546,
      changeOutputCount: 1,
      feeSurplusSats: 0,
    });

    mockAvailable([utxo('b', 10_000 + singleChangeFee + 545, P2WPKH)]);
    const belowDust = await selectUTXOsExact('wallet-1', 10_000, 2, context);
    expect(belowDust).toMatchObject({
      estimatedFee: singleChangeFee + 545,
      changeAmount: 0,
      changeOutputCount: 0,
      feeSurplusSats: 607,
    });
  });

  it('rejects a send-max recipient below dust', async () => {
    mockAvailable([utxo('a', 700, P2WPKH)]);
    await expect(selectUtxosForMode(
      'wallet-1', 0, 2, 546, true, false, p2wpkhContext(P2WPKH),
    )).rejects.toThrow('below dust threshold');
  });

  it('fails closed across send-max repository and evidence boundaries', async () => {
    mockAvailable([]);
    await expect(selectUtxosForMode(
      'wallet-1', 0, 2, 546, true, false, p2wpkhContext(P2WPKH),
    )).rejects.toThrow('No spendable UTXOs found');

    for (const missingValue of ['', null]) {
      const missingScript = utxo('a', 10_000, P2WPKH);
      missingScript.scriptPubKey = missingValue as unknown as string;
      mockAvailable([missingScript]);
      await expect(selectUtxosForMode(
        'wallet-1', 0, 2, 546, true, false, p2wpkhContext(P2WPKH),
      )).rejects.toThrow('missing scriptPubKey evidence');
    }

    const missingPolicy = utxo('b', 10_000, P2WPKH);
    mockAvailable([missingPolicy]);
    const context = p2wpkhContext(P2WPKH);
    context.resolveSpendPolicies = async () => new Map();
    await expect(selectUtxosForMode(
      'wallet-1', 0, 2, 546, true, false, context,
    )).rejects.toThrow('spend policy evidence is missing');

    const feeOnly = utxo('c', 110, P2WPKH);
    mockAvailable([feeOnly]);
    await expect(selectUtxosForMode(
      'wallet-1', 0, 1, 1, true, false, p2wpkhContext(P2WPKH),
    )).rejects.toThrow('not enough to cover fee');
  });

  it('honors explicit send-max coin control exactly', async () => {
    const first = utxo('a', 10_000, P2WPKH);
    const selected = utxo('b', 20_000, P2WPKH);
    mockAvailable([first, selected]);

    const result = await selectUtxosForMode(
      'wallet-1', 0, 2, 546, true, false, p2wpkhContext(P2WPKH),
      [`${selected.txid}:${selected.vout}`],
    );

    expect(result.selection.utxos.map(({ txid }) => txid)).toEqual([selected.txid]);
  });

  it('fails closed across subtract-fee repository and evidence boundaries', async () => {
    mockAvailable([]);
    await expect(selectUtxosForMode(
      'wallet-1', 10_000, 2, 546, false, true, p2wpkhContext(P2WPKH),
    )).rejects.toThrow('No spendable UTXOs available');

    mockAvailable([utxo('a', 5_000, P2WPKH)]);
    await expect(selectUtxosForMode(
      'wallet-1', 10_000, 2, 546, false, true, p2wpkhContext(P2WPKH),
    )).rejects.toThrow('Insufficient funds');

    const missingScript = utxo('b', 10_000, P2WPKH);
    missingScript.scriptPubKey = '';
    mockAvailable([missingScript]);
    await expect(selectUtxosForMode(
      'wallet-1', 9_000, 2, 546, false, true, p2wpkhContext(P2WPKH),
    )).rejects.toThrow('missing scriptPubKey evidence');

    const missingPolicy = utxo('c', 10_000, P2WPKH);
    mockAvailable([missingPolicy]);
    const context = p2wpkhContext(P2WPKH);
    context.resolveSpendPolicies = async () => new Map();
    await expect(selectUtxosForMode(
      'wallet-1', 9_000, 2, 546, false, true, context,
    )).rejects.toThrow('spend policy evidence is missing');

    mockAvailable([utxo('d', 1_000, P2WPKH)]);
    await expect(selectUtxosForMode(
      'wallet-1', 600, 1, 546, false, true, p2wpkhContext(P2WPKH),
    )).rejects.toThrow('not enough to cover fee');
  });

  it('honors explicit subtract-fee coin control exactly', async () => {
    const first = utxo('a', 10_000, P2WPKH);
    const selected = utxo('b', 20_000, P2WPKH);
    mockAvailable([first, selected]);

    const result = await selectUtxosForMode(
      'wallet-1', 15_000, 2, 546, false, true, p2wpkhContext(P2WPKH),
      [`${selected.txid}:${selected.vout}`],
    );

    expect(result.selection.utxos.map(({ txid }) => txid)).toEqual([selected.txid]);
  });

  it('rejects missing exact spend-policy evidence during normal selection', async () => {
    const fixture = utxo('a', 20_000, P2WPKH);
    mockAvailable([fixture]);
    const context = p2wpkhContext(P2WPKH);
    context.resolveSpendPolicies = async () => new Map();

    await expect(selectUTXOsExact('wallet-1', 10_000, 2, context))
      .rejects.toThrow('spend policy evidence is missing');
  });

  it('rejects missing script evidence during normal selection', async () => {
    const fixture = utxo('a', 20_000, P2WPKH);
    fixture.scriptPubKey = '';
    mockAvailable([fixture]);

    await expect(selectUTXOsExact('wallet-1', 10_000, 2, p2wpkhContext(P2WPKH)))
      .rejects.toThrow('missing scriptPubKey evidence');
  });

  it('maps exact normal selection into the transaction construction shape', async () => {
    mockAvailable([utxo('a', 20_000, P2WPKH)]);

    const result = await selectUtxosForMode(
      'wallet-1', 10_000, 2, 546, false, false, p2wpkhContext(P2WPKH),
    );

    expect(result).toMatchObject({
      effectiveAmount: 10_000,
      selection: {
        totalAmount: 20_000,
        changeOutputCount: 1,
        feeSurplusSats: 0,
        utxos: [{ amount: 20_000, scriptPubKey: P2WPKH }],
      },
    });
  });

  it.each(GENERATED_SIGNED_PSBT_VECTORS)(
    'keeps send-max and subtract-fee exact for Core-backed $scriptType policy',
    async (vector) => {
      const psbt = bitcoin.Psbt.fromBase64(vector.unsignedPsbtBase64);
      const input = coreVectorInput(vector, psbt);
      const { prevoutScript: _prevoutScript, ...evidence } = input;
      const recipientScript = psbt.txOutputs[0].script;
      const changeScript = psbt.txOutputs[1].script;
      const fixture = utxo('a', 100_000, Buffer.from(input.prevoutScript).toString('hex'));
      const context: ExactSelectionFeeContext = {
        resolveSpendPolicies: async () => new Map([[fixture.address, evidence]]),
        recipientScript,
        changeScripts: [changeScript],
        dustThreshold: 546,
      };
      const sendMaxFee = feeForRate(estimateTransactionWeight({
        inputs: [input],
        outputs: [{ scriptPubKey: recipientScript }],
      }).vsize, 2);
      mockAvailable([fixture]);

      const sendMax = await selectUtxosForMode(
        'wallet-1', 0, 2, 546, true, false, context,
      );
      expect(sendMax).toMatchObject({
        effectiveAmount: 100_000 - sendMaxFee,
        selection: { estimatedFee: sendMaxFee, changeAmount: 0 },
      });

      const subtractFee = feeForRate(estimateTransactionWeight({
        inputs: [input],
        outputs: [{ scriptPubKey: recipientScript }, { scriptPubKey: changeScript }],
      }).vsize, 2);
      mockAvailable([fixture]);
      const subtract = await selectUtxosForMode(
        'wallet-1', 90_000, 2, 546, false, true, context,
      );
      expect(subtract).toMatchObject({
        effectiveAmount: 90_000 - subtractFee,
        selection: { estimatedFee: subtractFee, changeAmount: 10_000 },
      });
      expect(subtract.effectiveAmount + subtract.selection.estimatedFee
        + subtract.selection.changeAmount).toBe(100_000);
    },
  );

  it('selects across the 253-input CompactSize boundary without approximation', async () => {
    const available = Array.from({ length: 253 }, (_, index) =>
      utxo(`u${index}`, 1_000, P2WPKH));
    const fee = feeForRate(estimateTransactionWeight({
      inputs: [{
        spendPolicy: { type: 'p2wpkh' },
        prevoutScript: Buffer.from(P2WPKH, 'hex'),
        count: 253,
      }],
      outputs: [{ scriptPubKey: Buffer.from(P2WPKH, 'hex') }],
    }).vsize, 1);
    const context = p2wpkhContext(P2WPKH);
    context.changeScripts = [];
    mockAvailable(available);

    const result = await selectUTXOsExact('wallet-1', 253_000 - fee, 1, context);

    expect(result.utxos).toHaveLength(253);
    expect(result).toMatchObject({
      totalAmount: 253_000,
      estimatedFee: fee,
      changeAmount: 0,
      feeSurplusSats: 0,
    });
  });

  it('selects exact fees across every enabled input and recipient script-family combination', async () => {
    const vectorData = GENERATED_SIGNED_PSBT_VECTORS.map(vector => {
      const psbt = bitcoin.Psbt.fromBase64(vector.unsignedPsbtBase64);
      return { vector, psbt, input: coreVectorInput(vector, psbt) };
    });

    for (const inputData of vectorData) {
      for (const outputData of vectorData) {
        const recipientScript = outputData.input.prevoutScript;
        const fee = feeForRate(estimateTransactionWeight({
          inputs: [inputData.input],
          outputs: [{ scriptPubKey: recipientScript }],
        }).vsize, 5);
        const fixture = utxo(
          `${inputData.vector.scriptType}-${outputData.vector.scriptType}`,
          100_000 + fee,
          Buffer.from(inputData.input.prevoutScript).toString('hex'),
        );
        const { prevoutScript: _prevoutScript, ...evidence } = inputData.input;
        mockAvailable([fixture]);

        const result = await selectUTXOsExact('wallet-1', 100_000, 5, {
          resolveSpendPolicies: async () => new Map([[fixture.address, evidence]]),
          recipientScript,
          changeScripts: [],
          dustThreshold: 546,
        });

        expect(result).toMatchObject({
          estimatedFee: fee,
          changeAmount: 0,
          feeSurplusSats: 0,
        });
      }
    }
  });

  it.each(GENERATED_SIGNED_PSBT_VECTORS)(
    'selects a fixed requested rate conservatively against Core-backed $scriptType signed size',
    async (vector) => {
      const psbt = bitcoin.Psbt.fromBase64(vector.unsignedPsbtBase64);
      expect(psbt.txInputs).toHaveLength(1);
      expect(psbt.txOutputs).toHaveLength(2);
      const input = coreVectorInput(vector, psbt);
      const inputData = psbt.data.inputs[0];
      const previous = inputData.witnessUtxo ?? bitcoin.Transaction
        .fromBuffer(inputData.nonWitnessUtxo!).outs[psbt.txInputs[0].index];
      const recipient = psbt.txOutputs[0];
      const change = psbt.txOutputs[1];
      const vsize = estimateTransactionWeight({
        inputs: [input],
        outputs: [recipient, change].map(output => ({ scriptPubKey: output.script })),
      }).vsize;
      const feeRate = 5;
      const selectedFee = Number(previous.value) - Number(recipient.value) - Number(change.value);

      const fixture = utxo('a', Number(previous.value), Buffer.from(previous.script).toString('hex'));
      mockAvailable([fixture]);
      const { prevoutScript: _prevoutScript, ...evidence } = input;
      const result = await selectUTXOsExact(
        'wallet-1',
        Number(recipient.value),
        feeRate,
        {
          resolveSpendPolicies: async () => new Map([[fixture.address, evidence]]),
          recipientScript: recipient.script,
          changeScripts: [change.script],
          dustThreshold: 546,
        },
      );

      expect(result).toMatchObject({
        estimatedFee: selectedFee,
        changeAmount: vector.expectedChangeValue,
        changeOutputCount: 1,
      });
      expect(Number(recipient.value)).toBe(vector.expectedRecipientValue);
      expect(Number(change.value)).toBe(vector.expectedChangeValue);
      expect(Number(recipient.value) + result.changeAmount + result.estimatedFee)
        .toBe(Number(previous.value));
      expect(vector.coreProof.decodedTransaction.vsize).toBe(vector.expectedVsize);
      expect(vector.expectedFee).toBe(vsize * feeRate);
      expect(vector.expectedFee).toBeGreaterThanOrEqual(vector.expectedVsize * feeRate);
      expect(vsize).toBeGreaterThanOrEqual(vector.expectedVsize);
      expect(result.estimatedFee / vector.expectedVsize).toBeGreaterThanOrEqual(feeRate);
      expect(vector.mempoolAccept.allowed).toBe(true);
    },
  );
});
