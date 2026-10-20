import { act, renderHook } from '@testing-library/react';
import { beforeEach, vi } from 'vitest';
import * as bitcoin from 'bitcoinjs-lib';

import type { TransactionState } from '../../../src/contexts/send/types';
import { useSendTransactionActions } from '../../../src/hooks/send/useSendTransactionActions';
import { ApiError } from '../../../src/api/client';
import { testPsbtSigningContext } from '../../fixtures/psbtSigningContext';

const sendTransactionActionMocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  showSuccess: vi.fn(),
  showInfo: vi.fn(),
  handleError: vi.fn(),
  playEventSound: vi.fn(),
  hardwareWallet: {
    isConnected: false,
    device: null as unknown,
    connect: vi.fn(),
    disconnect: vi.fn(),
    signPSBT: vi.fn(),
  },
  refetchQueries: vi.fn(),
  invalidateQueries: vi.fn(),
  downloadBinary: vi.fn(),
  createTransaction: vi.fn(),
  createBatchTransaction: vi.fn(),
  broadcastTransaction: vi.fn(),
  createDraft: vi.fn(),
  updateDraft: vi.fn(),
  deleteDraft: vi.fn(),
  attemptPayjoin: vi.fn(),
  releasePayjoinOriginal: vi.fn(),
  setDraftId: vi.fn(),
}));

export const mocks = sendTransactionActionMocks;

export const queryClient = {
  refetchQueries: mocks.refetchQueries,
  invalidateQueries: mocks.invalidateQueries,
};

vi.mock('react-router-dom', () => ({
  useNavigate: () => sendTransactionActionMocks.navigate,
}));

vi.mock('../../../src/contexts/CurrencyContext', () => ({
  useCurrency: () => ({
    format: (sats: number) => `${sats} sats`,
  }),
  usePriceFreeFormatter: () => ({
    format: (sats: number) => `${sats} sats`,
    unit: 'sats',
  }),
}));

vi.mock('../../../src/hooks/useErrorHandler', () => ({
  useErrorHandler: () => ({
    handleError: sendTransactionActionMocks.handleError,
    showSuccess: sendTransactionActionMocks.showSuccess,
    showInfo: sendTransactionActionMocks.showInfo,
  }),
}));

vi.mock('../../../src/hooks/useNotificationSound', () => ({
  useNotificationSound: () => ({
    playEventSound: sendTransactionActionMocks.playEventSound,
  }),
}));

vi.mock('../../../src/hooks/useHardwareWallet', () => ({
  useHardwareWallet: () => sendTransactionActionMocks.hardwareWallet,
}));

vi.mock('../../../src/api/transactions', () => ({
  createTransaction: sendTransactionActionMocks.createTransaction,
  createBatchTransaction: sendTransactionActionMocks.createBatchTransaction,
  broadcastTransaction: sendTransactionActionMocks.broadcastTransaction,
}));

vi.mock('../../../src/api/drafts', () => ({
  createDraft: sendTransactionActionMocks.createDraft,
  updateDraft: sendTransactionActionMocks.updateDraft,
  deleteDraft: sendTransactionActionMocks.deleteDraft,
}));

vi.mock('../../../src/api/payjoin', () => ({
  attemptPayjoin: sendTransactionActionMocks.attemptPayjoin,
  releasePayjoinOriginal: sendTransactionActionMocks.releasePayjoinOriginal,
}));

vi.mock('../../../src/providers/QueryProvider', () => ({
  queryClient: {
    refetchQueries: sendTransactionActionMocks.refetchQueries,
    invalidateQueries: sendTransactionActionMocks.invalidateQueries,
  },
}));

vi.mock('../../../src/utils/download', () => ({
  downloadBinary: sendTransactionActionMocks.downloadBinary,
}));

vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

export const baseWallet = {
  id: 'wallet-1',
  name: 'Primary Wallet',
  type: 'single_sig',
  network: 'mainnet',
  balance: 0,
} as any;

export const baseTxData = {
  psbtBase64: 'cHNidP8BAA==',
  intentId: 'intent-1',
  intentDigest: 'a'.repeat(64),
  fee: 123,
  totalInput: 10123,
  totalOutput: 10000,
  changeAmount: 0,
  changeAddress: 'bc1qchange',
  effectiveAmount: 10000,
  utxos: [{ txid: 'a'.repeat(64), vout: 0 }],
  outputs: [{ address: 'bc1qrecipient', amount: 10000 }],
  inputPaths: ["m/84'/0'/0'/0/0"],
  decoyOutputs: [],
  signingContext: testPsbtSigningContext,
};

export const createState = (override?: Partial<TransactionState>): TransactionState => ({
  currentStep: 'outputs',
  completedSteps: new Set(['type']),
  transactionType: 'standard',
  outputs: [],
  outputsValid: [],
  scanningOutputIndex: null,
  showCoinControl: false,
  selectedUTXOs: new Set(),
  feeRate: 1,
  rbfEnabled: false,
  subtractFees: false,
  useDecoys: false,
  decoyCount: 0,
  payjoinUrl: null,
  payjoinStatus: 'idle',
  signingDeviceId: null,
  expandedDeviceId: null,
  signedDevices: new Set(),
  unsignedPsbt: null,
  showPsbtOptions: false,
  psbtDeviceId: null,
  draftId: null,
  isDraftMode: false,
  replacesTxid: null,
  isSubmitting: false,
  error: null,
  ...override,
});

// ---------------------------------------------------------------------------
// Payjoin fixtures (two-round BIP78)
// ---------------------------------------------------------------------------

export const P2WPKH_SCRIPT = Uint8Array.from([0x00, 0x14, ...new Array(20).fill(0x11)]);
export const PEER_TXID = 'b'.repeat(62) + '01';

/**
 * A realistic BIP78 proposal for baseTxData: the wallet input (a…a:0) keeps
 * its 10123 sats; the receiver adds C = 5000 and pays r = 100 more fee out of
 * it, so its output goes from P = 10000 to P + C - r = 14900. Proposal fee =
 * 15123 - 14900 = 223, and the server's canonical amount is P - r = 9900.
 */
export const buildPayjoinProposal = (options: {
  peerPrevout?: 'witness' | 'nonWitness' | 'none';
  outputValue?: bigint;
} = {}): string => {
  const psbt = new bitcoin.Psbt();
  psbt.addInput({ hash: 'a'.repeat(64), index: 0, witnessUtxo: { script: P2WPKH_SCRIPT, value: 10123n } });
  const peerPrevout = options.peerPrevout ?? 'witness';
  if (peerPrevout === 'nonWitness') {
    const previous = new bitcoin.Transaction();
    previous.addInput(new Uint8Array(32), 0);
    previous.addOutput(P2WPKH_SCRIPT, 1n);
    previous.addOutput(P2WPKH_SCRIPT, 5000n);
    psbt.addInput({ hash: previous.getId(), index: 1, nonWitnessUtxo: previous.toBuffer() });
  } else {
    psbt.addInput({
      hash: PEER_TXID,
      index: 2,
      ...(peerPrevout === 'witness' && { witnessUtxo: { script: P2WPKH_SCRIPT, value: 5000n } }),
    });
  }
  psbt.addOutput({ script: P2WPKH_SCRIPT, value: options.outputValue ?? 14900n });
  return psbt.toBase64();
};

export const CANONICAL_AMOUNT = 9900;

export const payjoinSuccess = (proposalPsbt: string) => ({
  success: true,
  isPayjoin: true,
  proposalPsbt,
  amount: CANONICAL_AMOUNT,
  intentId: 'intent-2',
  intentDigest: 'b'.repeat(64),
  signingContext: { ...baseTxData.signingContext, unsignedTransactionDigest: 'c'.repeat(64) },
});

export const payjoinState = () => createState({
  outputs: [{ address: 'bc1qrecipient', amount: '10000', sendMax: false }],
  payjoinUrl: 'https://merchant.example/payjoin',
});

const withSenderSignature = (psbtBase64: string): string => {
  const psbt = bitcoin.Psbt.fromBase64(psbtBase64);
  psbt.updateInput(0, {
    partialSig: [{
      pubkey: Uint8Array.from([0x02, ...new Array(32).fill(0x22)]),
      signature: Uint8Array.from([0x30, 0x06, 0x02, 0x01, 0x01, 0x02, 0x01, 0x01, 0x01]),
    }],
  });
  return psbt.toBase64();
};

const buildOriginalPsbt = (): string => {
  const psbt = new bitcoin.Psbt();
  psbt.addInput({ hash: 'a'.repeat(64), index: 0, witnessUtxo: { script: P2WPKH_SCRIPT, value: 10123n } });
  psbt.addOutput({ script: P2WPKH_SCRIPT, value: 10000n });
  return psbt.toBase64();
};

/** The single-sig original as the user's hardware wallet signed it (round one). */
export const SIGNED_ORIGINAL = withSenderSignature(buildOriginalPsbt());
/** The proposal as the user's hardware wallet signed it (round two): the same unsigned tx as the proposal. */
export const SIGNED_PROPOSAL = withSenderSignature(buildPayjoinProposal());

export const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};

export const apiFailure = (status: number, reason?: string) =>
  new ApiError(`failed with ${status}`, status, reason ? { details: { reason } } : undefined);

export type SendTransactionActionsProps = Parameters<typeof useSendTransactionActions>[0];

export const renderSendTransactionActions = (override: Partial<SendTransactionActionsProps> = {}) =>
  renderHook(() =>
    useSendTransactionActions({
      walletId: 'wallet-1',
      wallet: baseWallet,
      state: createState(),
      setDraftId: sendTransactionActionMocks.setDraftId,
      ...override,
    })
  );

export const renderRerenderableSendTransactionActions = (initialState: TransactionState) =>
  renderHook(
    ({ state }: { state: TransactionState }) => useSendTransactionActions({
      walletId: 'wallet-1',
      wallet: baseWallet,
      state,
      setDraftId: sendTransactionActionMocks.setDraftId,
    }),
    { initialProps: { state: initialState } },
  );

/** A payjoin-eligible send whose original was signed by QR (round one is ready). */
export const renderSignedPayjoinSend = async (override: Partial<SendTransactionActionsProps> = {}) => {
  const view = renderSendTransactionActions({ state: payjoinState(), ...override });
  await act(async () => {
    await view.result.current.createTransaction();
  });
  await act(async () => {
    await view.result.current.processQrSignedPsbt(SIGNED_ORIGINAL, 'device-1');
  });
  return view;
};

/** Round one returned a proposal; the user signed it by QR (round two is ready). */
export const renderSignedPayjoinProposal = async () => {
  mocks.attemptPayjoin.mockResolvedValueOnce(payjoinSuccess(buildPayjoinProposal()) as any);
  const view = await renderSignedPayjoinSend();
  await act(async () => {
    await view.result.current.broadcastTransaction();
  });
  await act(async () => {
    await view.result.current.processQrSignedPsbt(SIGNED_PROPOSAL, 'device-1');
  });
  return view;
};

export const broadcastCalls = () =>
  mocks.broadcastTransaction.mock.calls.map(([, request]) => request as Record<string, unknown>);

export const setupUseSendTransactionActionsHarness = () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.hardwareWallet.isConnected = false;
    mocks.hardwareWallet.device = null;
    mocks.hardwareWallet.connect.mockResolvedValue(undefined);
    mocks.hardwareWallet.disconnect.mockImplementation(() => undefined);
    mocks.hardwareWallet.signPSBT.mockResolvedValue({ psbt: 'signed-psbt' });
    mocks.refetchQueries.mockResolvedValue(undefined);
    mocks.invalidateQueries.mockResolvedValue(undefined);
    mocks.createTransaction.mockResolvedValue(baseTxData as any);
    mocks.createBatchTransaction.mockResolvedValue(baseTxData as any);
    mocks.broadcastTransaction.mockResolvedValue({
      txid: 'f'.repeat(64),
    } as any);
    mocks.createDraft.mockResolvedValue({ id: 'draft-1' } as any);
    mocks.updateDraft.mockResolvedValue(undefined as any);
    mocks.deleteDraft.mockResolvedValue(undefined as any);
    mocks.attemptPayjoin.mockResolvedValue({
      success: false,
      isPayjoin: false,
      error: 'not available',
    } as any);
    mocks.releasePayjoinOriginal.mockResolvedValue({ restored: false });
  });
};

export {
  ApiError,
};
