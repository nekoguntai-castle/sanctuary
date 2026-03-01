import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSendTransactionActions } from '../../hooks/useSendTransactionActions';
import type { TransactionState } from '../../contexts/send/types';
import * as transactionsApi from '../../src/api/transactions';
import * as draftsApi from '../../src/api/drafts';
import * as payjoinApi from '../../src/api/payjoin';
import { ApiError } from '../../src/api/client';
import { queryClient } from '../../providers/QueryProvider';
import { downloadBinary } from '../../utils/download';

const mocks = vi.hoisted(() => ({
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
}));

vi.mock('react-router-dom', () => ({
  useNavigate: () => mocks.navigate,
}));

vi.mock('../../contexts/CurrencyContext', () => ({
  useCurrency: () => ({
    format: (sats: number) => `${sats} sats`,
  }),
}));

vi.mock('../../hooks/useErrorHandler', () => ({
  useErrorHandler: () => ({
    handleError: mocks.handleError,
    showSuccess: mocks.showSuccess,
    showInfo: mocks.showInfo,
  }),
}));

vi.mock('../../hooks/useNotificationSound', () => ({
  useNotificationSound: () => ({
    playEventSound: mocks.playEventSound,
  }),
}));

vi.mock('../../hooks/useHardwareWallet', () => ({
  useHardwareWallet: () => mocks.hardwareWallet,
}));

vi.mock('../../src/api/transactions', () => ({
  createTransaction: vi.fn(),
  createBatchTransaction: vi.fn(),
  broadcastTransaction: vi.fn(),
}));

vi.mock('../../src/api/drafts', () => ({
  createDraft: vi.fn(),
  updateDraft: vi.fn(),
  deleteDraft: vi.fn(),
}));

vi.mock('../../src/api/payjoin', () => ({
  attemptPayjoin: vi.fn(),
}));

vi.mock('../../providers/QueryProvider', () => ({
  queryClient: {
    refetchQueries: mocks.refetchQueries,
    invalidateQueries: mocks.invalidateQueries,
  },
}));

vi.mock('../../utils/download', () => ({
  downloadBinary: mocks.downloadBinary,
}));

vi.mock('../../utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

const baseWallet = {
  id: 'wallet-1',
  name: 'Primary Wallet',
  type: 'single_sig',
  network: 'mainnet',
  balance: 0,
} as any;

const baseTxData = {
  psbtBase64: 'cHNidP8BAA==',
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
};

const createState = (override?: Partial<TransactionState>): TransactionState => ({
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
  isSubmitting: false,
  error: null,
  ...override,
});

describe('useSendTransactionActions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.hardwareWallet.isConnected = false;
    mocks.hardwareWallet.device = null;
    mocks.hardwareWallet.connect.mockResolvedValue(undefined);
    mocks.hardwareWallet.disconnect.mockImplementation(() => undefined);
    mocks.hardwareWallet.signPSBT.mockResolvedValue({ psbt: 'signed-psbt' });
    mocks.refetchQueries.mockResolvedValue(undefined);
    mocks.invalidateQueries.mockResolvedValue(undefined);
    vi.mocked(transactionsApi.createTransaction).mockResolvedValue(baseTxData as any);
    vi.mocked(transactionsApi.createBatchTransaction).mockResolvedValue(baseTxData as any);
    vi.mocked(transactionsApi.broadcastTransaction).mockResolvedValue({
      txid: 'f'.repeat(64),
    } as any);
    vi.mocked(draftsApi.createDraft).mockResolvedValue({ id: 'draft-1' } as any);
    vi.mocked(draftsApi.updateDraft).mockResolvedValue(undefined as any);
    vi.mocked(draftsApi.deleteDraft).mockResolvedValue(undefined as any);
    vi.mocked(payjoinApi.attemptPayjoin).mockResolvedValue({
      success: false,
      error: 'not available',
    } as any);
  });

  it('validates missing address', async () => {
    const state = createState({
      outputs: [{ address: '', amount: '1000', sendMax: false }],
    });

    const { result } = renderHook(() =>
      useSendTransactionActions({
        walletId: 'wallet-1',
        wallet: baseWallet,
        state,
      })
    );

    let response = null;
    await act(async () => {
      response = await result.current.createTransaction();
    });
    expect(response).toBeNull();

    await waitFor(() => {
      expect(result.current.error).toBe('Output 1: Please enter a recipient address');
    });
  });

  it('validates invalid amount', async () => {
    const state = createState({
      outputs: [{ address: 'bc1qvalid', amount: '0', sendMax: false }],
    });

    const { result } = renderHook(() =>
      useSendTransactionActions({
        walletId: 'wallet-1',
        wallet: baseWallet,
        state,
      })
    );

    let response = null;
    await act(async () => {
      response = await result.current.createTransaction();
    });
    expect(response).toBeNull();

    await waitFor(() => {
      expect(result.current.error).toBe('Output 1: Please enter a valid amount');
    });
  });

  it('creates a single-output transaction and stores tx state', async () => {
    const state = createState({
      outputs: [{ address: 'bc1qrecipient', amount: '10000', sendMax: false }],
      feeRate: 5,
      rbfEnabled: true,
      subtractFees: true,
      useDecoys: true,
      decoyCount: 2,
      selectedUTXOs: new Set(['utxo-1']),
    });

    const { result } = renderHook(() =>
      useSendTransactionActions({
        walletId: 'wallet-1',
        wallet: baseWallet,
        state,
      })
    );

    let tx = null;
    await act(async () => {
      tx = await result.current.createTransaction();
    });

    expect(tx).not.toBeNull();
    expect(vi.mocked(transactionsApi.createTransaction)).toHaveBeenCalledWith('wallet-1', {
      recipient: 'bc1qrecipient',
      amount: 10000,
      feeRate: 5,
      selectedUtxoIds: ['utxo-1'],
      enableRBF: true,
      sendMax: false,
      subtractFees: true,
      decoyOutputs: { enabled: true, count: 2 },
    });
    expect(result.current.txData?.psbtBase64).toBe('cHNidP8BAA==');
    expect(result.current.unsignedPsbt).toBe('cHNidP8BAA==');
  });

  it('uses batch transaction API for multiple outputs', async () => {
    const state = createState({
      outputs: [
        { address: 'bc1qone', amount: '5000', sendMax: false },
        { address: 'bc1qtwo', amount: '5000', sendMax: false },
      ],
      feeRate: 2,
    });

    const { result } = renderHook(() =>
      useSendTransactionActions({
        walletId: 'wallet-1',
        wallet: baseWallet,
        state,
      })
    );

    await act(async () => {
      await result.current.createTransaction();
    });

    expect(vi.mocked(transactionsApi.createBatchTransaction)).toHaveBeenCalledWith('wallet-1', {
      outputs: [
        { address: 'bc1qone', amount: 5000, sendMax: false },
        { address: 'bc1qtwo', amount: 5000, sendMax: false },
      ],
      feeRate: 2,
      selectedUtxoIds: undefined,
      enableRBF: false,
    });
  });

  it('attempts payjoin and updates status on success', async () => {
    vi.mocked(payjoinApi.attemptPayjoin).mockResolvedValue({
      success: true,
      proposalPsbt: 'payjoin-proposal-psbt',
    } as any);

    const state = createState({
      outputs: [{ address: 'bc1qrecipient', amount: '10000', sendMax: false }],
      payjoinUrl: 'https://merchant.example/payjoin',
    });

    const { result } = renderHook(() =>
      useSendTransactionActions({
        walletId: 'wallet-1',
        wallet: baseWallet,
        state,
      })
    );

    await act(async () => {
      await result.current.createTransaction();
    });

    expect(vi.mocked(payjoinApi.attemptPayjoin)).toHaveBeenCalled();
    expect(result.current.payjoinStatus).toBe('success');
    expect(result.current.unsignedPsbt).toBe('payjoin-proposal-psbt');
  });

  it('marks payjoin as failed when payjoin errors', async () => {
    vi.mocked(payjoinApi.attemptPayjoin).mockRejectedValue(new Error('payjoin failed'));

    const state = createState({
      outputs: [{ address: 'bc1qrecipient', amount: '10000', sendMax: false }],
      payjoinUrl: 'https://merchant.example/payjoin',
    });

    const { result } = renderHook(() =>
      useSendTransactionActions({
        walletId: 'wallet-1',
        wallet: baseWallet,
        state,
      })
    );

    await act(async () => {
      await result.current.createTransaction();
    });

    expect(result.current.payjoinStatus).toBe('failed');
    expect(result.current.unsignedPsbt).toBe('cHNidP8BAA==');
  });

  it('marks payjoin as failed when payjoin responds with success=false', async () => {
    vi.mocked(payjoinApi.attemptPayjoin).mockResolvedValue({
      success: false,
      error: 'merchant rejected payjoin',
    } as any);

    const state = createState({
      outputs: [{ address: 'bc1qrecipient', amount: '10000', sendMax: false }],
      payjoinUrl: 'https://merchant.example/payjoin',
    });

    const { result } = renderHook(() =>
      useSendTransactionActions({
        walletId: 'wallet-1',
        wallet: baseWallet,
        state,
      })
    );

    await act(async () => {
      await result.current.createTransaction();
    });

    expect(result.current.payjoinStatus).toBe('failed');
    expect(result.current.unsignedPsbt).toBe('cHNidP8BAA==');
  });

  it('surfaces ApiError message when transaction creation fails', async () => {
    vi.mocked(transactionsApi.createTransaction).mockRejectedValueOnce(
      new ApiError('insufficient funds', 400)
    );
    const state = createState({
      outputs: [{ address: 'bc1qrecipient', amount: '10000', sendMax: false }],
    });

    const { result } = renderHook(() =>
      useSendTransactionActions({
        walletId: 'wallet-1',
        wallet: baseWallet,
        state,
      })
    );

    let tx = {} as any;
    await act(async () => {
      tx = await result.current.createTransaction();
    });

    expect(tx).toBeNull();
    await waitFor(() => {
      expect(result.current.error).toBe('insufficient funds');
    });
  });

  it('uses fallback error when transaction creation fails with non-ApiError', async () => {
    vi.mocked(transactionsApi.createTransaction).mockRejectedValueOnce(new Error('db down'));
    const state = createState({
      outputs: [{ address: 'bc1qrecipient', amount: '10000', sendMax: false }],
    });

    const { result } = renderHook(() =>
      useSendTransactionActions({
        walletId: 'wallet-1',
        wallet: baseWallet,
        state,
      })
    );

    let tx = {} as any;
    await act(async () => {
      tx = await result.current.createTransaction();
    });

    expect(tx).toBeNull();
    await waitFor(() => {
      expect(result.current.error).toBe('Failed to create transaction');
    });
  });

  it('returns an error when hardware signing is attempted without connection', async () => {
    const { result } = renderHook(() =>
      useSendTransactionActions({
        walletId: 'wallet-1',
        wallet: baseWallet,
        state: createState(),
        initialTxData: baseTxData as any,
      })
    );

    let signed = null;
    await act(async () => {
      signed = await result.current.signWithHardwareWallet();
    });
    expect(signed).toBeNull();
    await waitFor(() => {
      expect(result.current.error).toContain('Hardware wallet not connected');
    });
  });

  it('signs with connected hardware wallet', async () => {
    mocks.hardwareWallet.isConnected = true;
    mocks.hardwareWallet.device = { id: 'hw-1' };
    mocks.hardwareWallet.signPSBT.mockResolvedValue({ psbt: 'signed-by-hw' });

    const { result } = renderHook(() =>
      useSendTransactionActions({
        walletId: 'wallet-1',
        wallet: baseWallet,
        state: createState(),
        initialTxData: baseTxData as any,
      })
    );

    let signed = null;
    await act(async () => {
      signed = await result.current.signWithHardwareWallet();
    });
    expect(signed).toBe('signed-by-hw');
    expect(mocks.hardwareWallet.signPSBT).toHaveBeenCalled();
  });

  it('rejects unsupported device types for direct USB signing', async () => {
    const { result } = renderHook(() =>
      useSendTransactionActions({
        walletId: 'wallet-1',
        wallet: baseWallet,
        state: createState(),
        initialPsbt: 'unsigned-psbt',
        initialTxData: baseTxData as any,
      })
    );

    let ok = false;
    await act(async () => {
      ok = await result.current.signWithDevice({
        id: 'dev-x',
        type: 'UnknownVendor',
      } as any);
    });

    expect(ok).toBe(false);
    await waitFor(() => {
      expect(result.current.error).toContain('Unsupported device type');
    });
  });

  it('rejects file-based devices for USB signing flow', async () => {
    const { result } = renderHook(() =>
      useSendTransactionActions({
        walletId: 'wallet-1',
        wallet: baseWallet,
        state: createState(),
        initialPsbt: 'unsigned-psbt',
        initialTxData: baseTxData as any,
      })
    );

    let ok = false;
    await act(async () => {
      ok = await result.current.signWithDevice({
        id: 'dev-coldcard',
        type: 'Coldcard Mk4',
      } as any);
    });

    expect(ok).toBe(false);
    await waitFor(() => {
      expect(result.current.error).toContain('does not support USB signing');
    });
  });

  it('signs with a specific device and persists signature to draft', async () => {
    mocks.hardwareWallet.signPSBT.mockResolvedValue({
      psbt: 'signed-psbt-from-device',
      rawTx: 'deadbeef',
    });

    const state = createState({
      draftId: 'draft-123',
    });

    const { result } = renderHook(() =>
      useSendTransactionActions({
        walletId: 'wallet-1',
        wallet: baseWallet,
        state,
        initialPsbt: 'unsigned-psbt',
        initialTxData: baseTxData as any,
      })
    );

    let ok = false;
    await act(async () => {
      ok = await result.current.signWithDevice({
        id: 'dev-trezor',
        type: 'Trezor Safe 3',
      } as any);
    });

    expect(ok).toBe(true);
    expect(mocks.hardwareWallet.connect).toHaveBeenCalledWith('trezor');
    expect(mocks.hardwareWallet.disconnect).toHaveBeenCalled();
    await waitFor(() => {
      expect(result.current.unsignedPsbt).toBe('signed-psbt-from-device');
      expect(result.current.signedRawTx).toBe('deadbeef');
      expect(result.current.signedDevices.has('dev-trezor')).toBe(true);
    });
    expect(vi.mocked(draftsApi.updateDraft)).toHaveBeenCalledWith('wallet-1', 'draft-123', {
      signedPsbtBase64: 'signed-psbt-from-device',
      signedDeviceId: 'dev-trezor',
    });
  });

  it('fails broadcast when no transaction exists', async () => {
    const { result } = renderHook(() =>
      useSendTransactionActions({
        walletId: 'wallet-1',
        wallet: baseWallet,
        state: createState(),
      })
    );

    let ok = false;
    await act(async () => {
      ok = await result.current.broadcastTransaction();
    });
    expect(ok).toBe(false);
    await waitFor(() => {
      expect(result.current.error).toBe('No transaction to broadcast');
    });
  });

  it('broadcasts signed transaction, refreshes queries, and navigates', async () => {
    const state = createState({
      outputs: [{ address: 'bc1qrecipient', amount: '10000', sendMax: false }],
      draftId: 'draft-456',
    });

    const { result } = renderHook(() =>
      useSendTransactionActions({
        walletId: 'wallet-1',
        wallet: baseWallet,
        state,
        initialPsbt: 'signed-psbt',
        initialTxData: baseTxData as any,
      })
    );

    let ok = false;
    await act(async () => {
      ok = await result.current.broadcastTransaction();
    });
    expect(ok).toBe(true);
    expect(vi.mocked(transactionsApi.broadcastTransaction)).toHaveBeenCalledWith('wallet-1', {
      signedPsbtBase64: 'signed-psbt',
      rawTxHex: undefined,
      recipient: 'bc1qrecipient',
      amount: 10000,
      fee: 123,
      utxos: baseTxData.utxos,
    });
    expect(mocks.refetchQueries).toHaveBeenCalledTimes(3);
    expect(mocks.invalidateQueries).toHaveBeenCalledTimes(2);
    expect(vi.mocked(draftsApi.deleteDraft)).toHaveBeenCalledWith('wallet-1', 'draft-456');
    expect(mocks.playEventSound).toHaveBeenCalledWith('send');
    expect(mocks.showSuccess).toHaveBeenCalled();
    expect(mocks.navigate).toHaveBeenCalledWith('/wallets/wallet-1');
  });

  it('creates a new draft and navigates to the wallet', async () => {
    const state = createState({
      outputs: [{ address: 'bc1qrecipient', amount: '10000', sendMax: false }],
      feeRate: 3,
      rbfEnabled: true,
    });

    const { result } = renderHook(() =>
      useSendTransactionActions({
        walletId: 'wallet-1',
        wallet: baseWallet,
        state,
      })
    );

    let draftId = null;
    await act(async () => {
      draftId = await result.current.saveDraft('Payroll payment');
    });
    expect(draftId).toBe('draft-1');
    expect(vi.mocked(draftsApi.createDraft)).toHaveBeenCalled();
    expect(mocks.navigate).toHaveBeenCalledWith('/wallets/wallet-1');
  });

  it('updates existing draft with signature metadata', async () => {
    const state = createState({
      outputs: [{ address: 'bc1qrecipient', amount: '10000', sendMax: false }],
      draftId: 'draft-existing',
    });

    const { result } = renderHook(() =>
      useSendTransactionActions({
        walletId: 'wallet-1',
        wallet: baseWallet,
        state,
        initialPsbt: 'signed-psbt-v2',
        initialTxData: baseTxData as any,
      })
    );

    act(() => {
      result.current.markDeviceSigned('dev-1');
    });

    let draftId = null;
    await act(async () => {
      draftId = await result.current.saveDraft();
    });
    expect(draftId).toBe('draft-existing');
    expect(vi.mocked(draftsApi.updateDraft)).toHaveBeenCalledWith('wallet-1', 'draft-existing', {
      signedPsbtBase64: 'signed-psbt-v2',
      signedDeviceId: 'dev-1',
    });
    expect(mocks.showSuccess).toHaveBeenCalledWith('Draft updated successfully', 'Draft Saved');
  });

  it('sets error when downloading PSBT without transaction data', () => {
    const { result } = renderHook(() =>
      useSendTransactionActions({
        walletId: 'wallet-1',
        wallet: baseWallet,
        state: createState(),
      })
    );

    act(() => {
      result.current.downloadPsbt();
    });

    expect(result.current.error).toBe('No PSBT available to download');
  });

  it('downloads PSBT binary when unsigned PSBT is present', () => {
    const { result } = renderHook(() =>
      useSendTransactionActions({
        walletId: 'wallet-1',
        wallet: baseWallet,
        state: createState(),
        initialPsbt: 'cHNidP8BAA==',
      })
    );

    act(() => {
      result.current.downloadPsbt();
    });

    expect(downloadBinary).toHaveBeenCalledWith(expect.any(Uint8Array), 'Primary Wallet_unsigned.psbt');
  });

  it('uploads a signed PSBT file and tracks the signing device', async () => {
    const file = new File(['cHNidP8BAA=='], 'signed.psbt', { type: 'text/plain' });

    const { result } = renderHook(() =>
      useSendTransactionActions({
        walletId: 'wallet-1',
        wallet: baseWallet,
        state: createState(),
      })
    );

    await act(async () => {
      await result.current.uploadSignedPsbt(file, 'device-upload');
    });

    expect(result.current.unsignedPsbt).toBe('cHNidP8BAA==');
    expect(result.current.signedDevices.has('device-upload')).toBe(true);
  });

  it('processes QR signed PSBT and persists it to draft', async () => {
    const state = createState({
      draftId: 'draft-qr',
    });

    const { result } = renderHook(() =>
      useSendTransactionActions({
        walletId: 'wallet-1',
        wallet: baseWallet,
        state,
      })
    );

    await act(async () => {
      await result.current.processQrSignedPsbt('qr-signed-psbt', 'dev-qr');
    });

    expect(result.current.unsignedPsbt).toBe('qr-signed-psbt');
    expect(result.current.signedDevices.has('dev-qr')).toBe(true);
    expect(vi.mocked(draftsApi.updateDraft)).toHaveBeenCalledWith('wallet-1', 'draft-qr', {
      signedPsbtBase64: 'qr-signed-psbt',
      signedDeviceId: 'dev-qr',
    });
  });

  it('clears errors and fully resets local state', async () => {
    const state = createState({
      outputs: [{ address: '', amount: '1000', sendMax: false }],
    });

    const { result } = renderHook(() =>
      useSendTransactionActions({
        walletId: 'wallet-1',
        wallet: baseWallet,
        state,
        initialPsbt: 'cHNidP8BAA==',
        initialTxData: baseTxData as any,
      })
    );

    await act(async () => {
      await result.current.createTransaction();
    });
    expect(result.current.error).toContain('recipient address');

    act(() => {
      result.current.clearError();
      result.current.reset();
    });

    expect(result.current.error).toBeNull();
    expect(result.current.txData).toBeNull();
    expect(result.current.unsignedPsbt).toBeNull();
    expect(result.current.signedRawTx).toBeNull();
    expect(result.current.signedDevices.size).toBe(0);
    expect(result.current.payjoinStatus).toBe('idle');
  });

  it('exposes shared query client from mocks for sanity', () => {
    expect(queryClient).toBeDefined();
    expect(mocks.refetchQueries).toBeTypeOf('function');
  });
});
