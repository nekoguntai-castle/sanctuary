import { describe, expect, it } from 'vitest';
import { WalletType } from '../../../src/types';
import { UNATTRIBUTED_SIGNATURE_ID } from '../../../src/hooks/send/types';
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

  it('carries decoy change from the saved draft into the resumed transaction data', () => {
    const decoyOutputs = [{ address: 'bc1qdecoy1', amount: 300 }, { address: 'bc1qdecoy2', amount: 200 }];
    const draft = { ...draftTxData, signingIntentId: 'intent-1', signingIntentDigest: 'a'.repeat(64), decoyOutputs };
    const resumed = buildDraftTxData(draft as any);
    expect(resumed.decoyOutputs).toEqual(decoyOutputs);
    expect(createDraftInitialTxData({ state, draftTxData: resumed, utxos })?.decoyOutputs).toEqual(decoyOutputs);
  });

  it('keeps the server-issued signing context when resuming a draft', () => {
    const ctx = { walletType: 'multi_sig' } as any;
    const draft = { ...draftTxData, signingIntentId: 'intent-1', signingIntentDigest: 'a'.repeat(64) };
    const resumed = buildDraftTxData({ ...draft, signingContext: ctx } as any);
    expect(resumed.signingContext).toBe(ctx);
    expect(createDraftInitialTxData({ state, draftTxData: resumed, utxos })?.signingContext).toBe(ctx);
    expect(buildDraftTxData({ ...draft, signingContext: null } as any).signingContext).toBeUndefined();
  });

  it('resumes a draft with the recipient draft creation bound, not the first listed output', () => {
    const draft = {
      ...draftTxData,
      signingIntentId: 'intent-1',
      signingIntentDigest: 'a'.repeat(64),
      recipient: 'bc1qtwo',
    };
    const resumed = buildDraftTxData(draft as any);
    expect(resumed.recipient).toBe('bc1qtwo');
    expect(createDraftInitialTxData({ state, draftTxData: resumed, utxos })?.recipient).toBe('bc1qtwo');
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
      walletType: WalletType.SINGLE_SIG,
    });

    expect(initialState?.outputs).toEqual([{ address, amount: '0', sendMax: true }]);
    expect(createDraftInitialTxData({
      draftTxData: buildDraftTxData(draftData),
      state: initialState as any,
      utxos: [],
    })?.outputs).toEqual([{ address, amount: 0, sendMax: true }]);
  });
});

describe('buildInitialState — RBF replacesTxid linkage', () => {
  const baseDraftData = {
    id: 'draft-rbf',
    walletId: 'wallet-1',
    userId: 'user-1',
    recipient: 'bc1qrecipient',
    amount: 10_000,
    psbtBase64: 'draft-rbf-psbt',
    signingIntentId: 'intent-rbf',
    signingIntentDigest: 'c'.repeat(64),
    feeRate: 5,
    selectedUtxoIds: [],
    enableRBF: true,
    subtractFees: false,
    isRBF: true,
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
  } as any;

  it('copies the client-attached replacesTxid into the initial wizard state', () => {
    const draftData = { ...baseDraftData, replacesTxid: 'a'.repeat(64) };

    const initialState = buildInitialState({
      addresses: [], draftData, showInfo: () => undefined, utxos: [], walletType: WalletType.SINGLE_SIG,
    });

    expect(initialState?.replacesTxid).toBe('a'.repeat(64));
  });

  it('defaults replacesTxid to null when the draft carries none', () => {
    const initialState = buildInitialState({
      addresses: [], draftData: baseDraftData, showInfo: () => undefined, utxos: [], walletType: WalletType.SINGLE_SIG,
    });

    expect(initialState?.replacesTxid).toBeNull();
  });

  it('binds a restored payjoin endpoint to the first restored output', () => {
    const initialState = buildInitialState({
      addresses: [],
      draftData: { ...baseDraftData, payjoinUrl: 'https://merchant.example/pj' },
      showInfo: () => undefined,
      utxos: [],
      walletType: WalletType.SINGLE_SIG,
    });

    expect(initialState?.payjoinUrl).toBe('https://merchant.example/pj');
    expect(initialState?.payjoinAddress).toBe('bc1qrecipient');
  });

  it('restores no payjoin binding for a draft without an endpoint', () => {
    const initialState = buildInitialState({
      addresses: [], draftData: baseDraftData, showInfo: () => undefined, utxos: [], walletType: WalletType.SINGLE_SIG,
    });

    expect(initialState?.payjoinAddress).toBeNull();
  });
});

describe('buildInitialState — resumed draft with an unattributed uploaded signature', () => {
  const uploadedDraft = {
    id: 'draft-upload',
    recipient: 'bc1qrecipient',
    amount: 10_000,
    walletId: 'wallet-1',
    userId: 'user-1',
    psbtBase64: 'unsigned-psbt',
    signedPsbtBase64: 'signed-psbt',
    signingIntentId: 'intent-upload',
    signingIntentDigest: 'd'.repeat(64),
    feeRate: 5,
    selectedUtxoIds: [],
    enableRBF: true,
    subtractFees: false,
    isRBF: false,
    status: 'partial',
    signedDeviceIds: [],
    fee: 100,
    totalInput: 10_100,
    totalOutput: 10_000,
    changeAmount: 0,
    effectiveAmount: 10_000,
    inputPaths: [],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  } as any;
  const build = (walletType: WalletType, draftData = uploadedDraft) => buildInitialState({
    addresses: [], draftData, showInfo: () => undefined, utxos: [], walletType,
  });

  it('seeds the UI-only marker for a single-sig wallet so Sign & Broadcast works', () => {
    const state = build(WalletType.SINGLE_SIG);

    expect(state?.unsignedPsbt).toBe('signed-psbt');
    expect(state?.signedDevices).toEqual([UNATTRIBUTED_SIGNATURE_ID]);
  });

  it('does not seed the marker for a multisig wallet (it must not count toward the quorum)', () => {
    expect(build(WalletType.MULTI_SIG)?.signedDevices).toEqual([]);
  });

  it('keeps attributed device ids and seeds nothing without an uploaded signature', () => {
    expect(build(WalletType.SINGLE_SIG, { ...uploadedDraft, signedDeviceIds: ['dev-1'] })?.signedDevices)
      .toEqual(['dev-1']);
    expect(build(WalletType.SINGLE_SIG, { ...uploadedDraft, signedPsbtBase64: undefined })?.signedDevices)
      .toEqual([]);
  });
});
