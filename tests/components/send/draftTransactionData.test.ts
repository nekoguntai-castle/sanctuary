import { describe, expect, it } from 'vitest';
import { createDraftInitialTxData } from '../../../src/components/send/SendTransactionWizard/draftTransactionData';
import {
  buildDraftTxData,
  buildInitialState,
} from '../../../src/components/send/SendTransactionPage/sendTransactionPageHelpers';

const draftTxData = {
  intentId: 'intent-1',
  intentDigest: 'a'.repeat(64),
  fee: 100,
  totalInput: 12_000,
  totalOutput: 10_000,
  changeAmount: 1_900,
  changeAddress: 'bc1qchange',
  effectiveAmount: 10_000,
  selectedUtxoIds: ['known:1', 'missing:2'],
  inputPaths: ["m/84'/0'/0'/0/0"],
};

const state = {
  isDraftMode: true,
  unsignedPsbt: 'draft-psbt',
  outputs: [
    { address: 'bc1qone', amount: '4000', sendMax: false },
    { address: 'bc1qtwo', amount: '6000', sendMax: false },
  ],
} as any;

const utxos = [{
  id: 'known:1',
  txid: 'known',
  vout: 1,
  address: 'bc1qinput',
  amount: 12_000,
}] as any;

describe('createDraftInitialTxData', () => {
  it.each([
    { state: { ...state, isDraftMode: false }, draftTxData },
    { state, draftTxData: undefined },
    { state: { ...state, unsignedPsbt: null }, draftTxData },
    { state: { ...state, outputs: [{ address: 'bc1qbad', amount: '.', sendMax: false }] }, draftTxData },
    { state, draftTxData: { ...draftTxData, effectiveAmount: Number.MAX_SAFE_INTEGER + 1 } },
  ])('rejects incomplete or invalid draft input %#', (input) => {
    expect(createDraftInitialTxData({ ...input, utxos })).toBeNull();
  });

  it('keeps legacy drafts viewable but refuses to resume signing without an intent', () => {
    expect(createDraftInitialTxData({
      state,
      draftTxData: { ...draftTxData, intentId: undefined, intentDigest: undefined },
      utxos,
    })).toBeNull();
  });

  it('maps valid outputs and resolves available UTXO details', () => {
    expect(createDraftInitialTxData({ state, draftTxData, utxos })).toEqual({
      psbtBase64: 'draft-psbt',
      intentId: 'intent-1',
      intentDigest: 'a'.repeat(64),
      fee: 100,
      totalInput: 12_000,
      totalOutput: 10_000,
      changeAmount: 1_900,
      changeAddress: 'bc1qchange',
      effectiveAmount: 10_000,
      utxos: [
        { txid: 'known', vout: 1, address: 'bc1qinput', amount: 12_000 },
        { txid: 'missing', vout: 2, address: '', amount: 0 },
      ],
      outputs: [
        { address: 'bc1qone', amount: 4_000, sendMax: false },
        { address: 'bc1qtwo', amount: 6_000, sendMax: false },
      ],
      inputPaths: ["m/84'/0'/0'/0/0"],
    });
  });

  it.each([
    {
      name: 'structured',
      draft: {
        outputs: [{ address: 'bc1qstructuredmax', amount: 0, sendMax: true }],
        recipient: 'bc1qlegacy',
        amount: 0,
        sendMax: false,
      },
      address: 'bc1qstructuredmax',
    },
    {
      name: 'legacy',
      draft: {
        outputs: undefined,
        recipient: 'bc1qlegacymax',
        amount: 0,
        sendMax: true,
      },
      address: 'bc1qlegacymax',
    },
  ])('preserves $name sendMax while hydrating resumed transaction data', ({ draft, address }) => {
    const draftData = {
      id: 'draft-max',
      walletId: 'wallet-1',
      userId: 'user-1',
      psbtBase64: 'draft-max-psbt',
      signingIntentId: 'intent-max',
      signingIntentDigest: 'b'.repeat(64),
      feeRate: 5,
      selectedUtxoIds: [],
      enableRBF: true,
      subtractFees: false,
      isRBF: false,
      status: 'unsigned',
      signedDeviceIds: [],
      fee: 100,
      totalInput: 10_100,
      totalOutput: 10_000,
      changeAmount: 0,
      effectiveAmount: 10_000,
      inputPaths: [],
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
      ...draft,
    } as any;
    const initialState = buildInitialState({
      addresses: [],
      draftData,
      showInfo: () => undefined,
      utxos: [],
    });

    expect(initialState?.outputs).toEqual([{ address, amount: '0', sendMax: true }]);
    expect(createDraftInitialTxData({
      draftTxData: buildDraftTxData(draftData),
      state: initialState as any,
      utxos: [],
    })?.outputs).toEqual([{ address, amount: 0, sendMax: true }]);
  });
});
