import * as bitcoin from 'bitcoinjs-lib';
import { describe, expect, it } from 'vitest';
import type { TransactionData } from '../../../../../src/hooks/send/types';
import type { TransactionState } from '../../../../../src/contexts/send/types';
import {
  buildReviewFlowData,
  getReviewChangeAmount,
  toBitcoinJsNetwork,
} from '../../../../../src/components/send/steps/review/reviewStepData';
import {
  CHANGE,
  P2TR_ADDRESS,
  P2TR_CHANGE_ADDRESS,
  P2TR_CHANGE_SCRIPT,
  P2TR_SCRIPT,
  PAYMENT,
  psbtWithOutputs,
} from '../../../../fixtures/payjoinPsbt';

const fixed = [{ address: 'bc1qfixed', amount: '5000', sendMax: false }];
const max = [{ address: 'bc1qmax', amount: '0', sendMax: true }];

describe('getReviewChangeAmount', () => {
  it('estimates change before the transaction is built', () => {
    expect(getReviewChangeAmount(fixed, 1_000_000, 5000, 200)).toBe(994_800);
    expect(getReviewChangeAmount(fixed, 1_000, 5000, 200)).toBe(0);
    expect(getReviewChangeAmount(max, 1_000_000, 0, 200)).toBe(0);
    expect(getReviewChangeAmount(fixed, 1_000_000, 5000, 200, null)).toBe(994_800);
  });

  it('uses the real change of the built transaction instead of the all-UTXO heuristic', () => {
    const txData = { changeAmount: 50_000 } as TransactionData;
    expect(getReviewChangeAmount(fixed, 1_000_000, 5000, 200, txData)).toBe(50_000);
  });

  it('counts decoy change and tolerates a missing changeAmount', () => {
    const decoys = { changeAmount: 0, decoyOutputs: [{ address: 'a', amount: 3000 }, { address: 'b', amount: 4000 }] } as TransactionData;
    expect(getReviewChangeAmount(fixed, 1_000_000, 5000, 200, decoys)).toBe(7000);
    expect(getReviewChangeAmount(fixed, 1_000_000, 5000, 200, {} as TransactionData)).toBe(0);
  });
});

// Original: sender input 14123 pays P=10000 with change 4000 (fee 123). The receiver adds a
// 5000-sat input and keeps 100 sats of it as its fee share, so its output grows by 4900.
const SENDER_INPUT = { txid: 'a'.repeat(64), vout: 0, address: 'bc1qsender', amount: 14123 };
const RECEIVER_INPUT = { txid: 'b'.repeat(64), vout: 2, amount: 5000 };

interface ProposalScripts {
  payment: Uint8Array;
  change: Uint8Array;
  paymentAddress: string;
  changeAddress: string;
}

function p2wpkhScripts(network: bitcoin.Network): ProposalScripts {
  return {
    payment: PAYMENT,
    change: CHANGE,
    paymentAddress: bitcoin.address.fromOutputScript(PAYMENT, network),
    changeAddress: bitcoin.address.fromOutputScript(CHANGE, network),
  };
}

function originalTx(scripts: ProposalScripts): TransactionData {
  return {
    psbtBase64: psbtWithOutputs([[scripts.payment, 10000], [scripts.change, 4000]]),
    intentId: 'intent-1',
    intentDigest: 'a'.repeat(64),
    fee: 123,
    totalInput: 14123,
    totalOutput: 14000,
    changeAmount: 4000,
    changeAddress: scripts.changeAddress,
    effectiveAmount: 10000,
    utxos: [SENDER_INPUT],
    outputs: [{ address: scripts.paymentAddress, amount: 10000 }],
  };
}

function proposalTx(scripts: ProposalScripts, overrides: Partial<TransactionData> = {}): TransactionData {
  return {
    ...originalTx(scripts),
    psbtBase64: psbtWithOutputs([[scripts.payment, 14900], [scripts.change, 4000]], 2),
    intentId: 'intent-2',
    fee: 223,
    totalInput: 19123,
    totalOutput: 18900,
    effectiveAmount: 9900,
    utxos: [SENDER_INPUT, RECEIVER_INPUT],
    ...overrides,
  };
}

function reviewFlow(
  txData: TransactionData,
  original: TransactionData,
  network: Parameters<typeof toBitcoinJsNetwork>[0],
) {
  return buildReviewFlowData({
    ...reviewFlowParams(txData),
    payjoinStatus: 'awaiting-signature',
    payjoinOriginalTxData: original,
    network,
  });
}

function sumOutputs(flow: ReturnType<typeof reviewFlow>): number {
  return flow.outputs.reduce((sum, output) => sum + output.amount, 0);
}

describe('buildReviewFlowData for a payjoin proposal under review', () => {
  it('previews the proposal outputs, flags change and labels the receiver input', () => {
    const scripts = p2wpkhScripts(bitcoin.networks.bitcoin);
    const flow = reviewFlow(proposalTx(scripts), originalTx(scripts), 'mainnet');

    expect(flow.outputs).toEqual([
      { address: scripts.paymentAddress, amount: 14900, isChange: false, label: undefined },
      { address: scripts.changeAddress, amount: 4000, isChange: true, label: undefined },
    ]);
    expect(sumOutputs(flow)).toBe(flow.totalOutput);
    expect(flow.inputs[1].label).toBe('Receiver input');
    expect(flow.inputs[0].label).toBeUndefined();
  });

  it('flags a Stonewall decoy output as change', () => {
    const scripts = p2wpkhScripts(bitcoin.networks.bitcoin);
    const proposal = proposalTx(scripts, {
      changeAddress: 'bc1qnotinpsbt',
      decoyOutputs: [{ address: scripts.changeAddress, amount: 4000 }],
    });
    const flow = reviewFlow(proposal, originalTx(scripts), 'mainnet');

    expect(flow.outputs.map((output) => output.isChange)).toEqual([false, true]);
    expect(sumOutputs(flow)).toBe(flow.totalOutput);
  });

  it.each([
    ['regtest', bitcoin.networks.regtest, 'bcrt1'],
    ['signet', bitcoin.networks.testnet, 'tb1'],
  ] as const)('detects change on %s', (network, bitcoinNetwork, prefix) => {
    const scripts = p2wpkhScripts(bitcoinNetwork);
    expect(scripts.changeAddress.startsWith(prefix)).toBe(true);
    const flow = reviewFlow(proposalTx(scripts), originalTx(scripts), network);

    expect(flow.outputs.map((output) => output.isChange)).toEqual([false, true]);
    expect(sumOutputs(flow)).toBe(flow.totalOutput);
  });

  it('decodes P2TR proposal outputs', () => {
    const scripts: ProposalScripts = {
      payment: P2TR_SCRIPT,
      change: P2TR_CHANGE_SCRIPT,
      paymentAddress: P2TR_ADDRESS,
      changeAddress: P2TR_CHANGE_ADDRESS,
    };
    const flow = reviewFlow(proposalTx(scripts), originalTx(scripts), 'mainnet');

    // Fixture keys are real BIP86 vectors; this needs the ECC library reviewStepData initialises.
    expect(bitcoin.address.fromOutputScript(P2TR_SCRIPT, bitcoin.networks.bitcoin)).toBe(P2TR_ADDRESS);
    expect(bitcoin.address.fromOutputScript(P2TR_CHANGE_SCRIPT, bitcoin.networks.bitcoin)).toBe(P2TR_CHANGE_ADDRESS);
    expect(flow.outputs.map((output) => [output.address, output.isChange])).toEqual([
      [P2TR_ADDRESS, false],
      [P2TR_CHANGE_ADDRESS, true],
    ]);
    expect(sumOutputs(flow)).toBe(flow.totalOutput);
  });

  it('falls back to the built outputs when the proposal PSBT does not decode', () => {
    const scripts = p2wpkhScripts(bitcoin.networks.bitcoin);
    const flow = reviewFlow(proposalTx(scripts, { psbtBase64: 'not-a-psbt' }), originalTx(scripts), 'mainnet');

    expect(flow.outputs.map((output) => output.amount)).toEqual([10000, 4000]);
  });

  it('keeps the round-one preview while no proposal is under review', () => {
    const scripts = p2wpkhScripts(bitcoin.networks.bitcoin);
    const flow = buildReviewFlowData({
      ...reviewFlowParams(originalTx(scripts)),
      payjoinStatus: 'negotiating',
      payjoinOriginalTxData: null,
      network: 'mainnet',
    });

    expect(flow.outputs.map((output) => output.amount)).toEqual([10000, 4000]);
    expect(flow.inputs[0].label).toBeUndefined();
  });

  it('previews the typed outputs when the proposal is not built yet', () => {
    const scripts = p2wpkhScripts(bitcoin.networks.bitcoin);
    const flow = buildReviewFlowData({
      ...reviewFlowParams(originalTx(scripts)),
      state: { outputs: [{ address: 'bc1qtyped', amount: '700', sendMax: false }], selectedUTXOs: new Set() } as unknown as TransactionState,
      txData: null,
      payjoinStatus: 'awaiting-signature',
      payjoinOriginalTxData: originalTx(scripts),
      network: 'mainnet',
    });

    expect(flow.outputs.map((output) => output.address)).toEqual(['bc1qtyped']);
  });
});

function reviewFlowParams(txData: TransactionData) {
  return {
    state: { outputs: [], selectedUTXOs: new Set() } as unknown as TransactionState,
    utxos: [],
    spendableUtxos: [],
    txData,
    selectedTotal: 0,
    totalOutputAmount: 0,
    estimatedFee: 0,
    changeAmount: 0,
    getAddressLabel: () => undefined,
  };
}

describe('toBitcoinJsNetwork', () => {
  it.each([
    [undefined, bitcoin.networks.bitcoin],
    ['mainnet', bitcoin.networks.bitcoin],
    ['regtest', bitcoin.networks.regtest],
    ['testnet3', bitcoin.networks.testnet],
    ['testnet4', bitcoin.networks.testnet],
    ['signet', bitcoin.networks.testnet],
  ] as const)('maps %s', (network, expected) => {
    expect(toBitcoinJsNetwork(network)).toBe(expected);
  });
});
