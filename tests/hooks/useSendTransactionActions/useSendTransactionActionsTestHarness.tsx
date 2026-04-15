import { renderHook } from '@testing-library/react';
import { beforeEach, vi } from 'vitest';

import type { TransactionState } from '../../../contexts/send/types';
import { useSendTransactionActions } from '../../../hooks/send/useSendTransactionActions';
import { ApiError } from '../../../src/api/client';

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
}));

export const mocks = sendTransactionActionMocks;

export const queryClient = {
  refetchQueries: mocks.refetchQueries,
  invalidateQueries: mocks.invalidateQueries,
};

vi.mock('react-router-dom', () => ({
  useNavigate: () => sendTransactionActionMocks.navigate,
}));

vi.mock('../../../contexts/CurrencyContext', () => ({
  useCurrency: () => ({
    format: (sats: number) => `${sats} sats`,
  }),
}));

vi.mock('../../../hooks/useErrorHandler', () => ({
  useErrorHandler: () => ({
    handleError: sendTransactionActionMocks.handleError,
    showSuccess: sendTransactionActionMocks.showSuccess,
    showInfo: sendTransactionActionMocks.showInfo,
  }),
}));

vi.mock('../../../hooks/useNotificationSound', () => ({
  useNotificationSound: () => ({
    playEventSound: sendTransactionActionMocks.playEventSound,
  }),
}));

vi.mock('../../../hooks/useHardwareWallet', () => ({
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
}));

vi.mock('../../../providers/QueryProvider', () => ({
  queryClient: {
    refetchQueries: sendTransactionActionMocks.refetchQueries,
    invalidateQueries: sendTransactionActionMocks.invalidateQueries,
  },
}));

vi.mock('../../../utils/download', () => ({
  downloadBinary: sendTransactionActionMocks.downloadBinary,
}));

vi.mock('../../../utils/logger', () => ({
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
  isSubmitting: false,
  error: null,
  ...override,
});

export type SendTransactionActionsProps = Parameters<typeof useSendTransactionActions>[0];

export const renderSendTransactionActions = (override: Partial<SendTransactionActionsProps> = {}) =>
  renderHook(() =>
    useSendTransactionActions({
      walletId: 'wallet-1',
      wallet: baseWallet,
      state: createState(),
      ...override,
    })
  );

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
      error: 'not available',
    } as any);
  });
};

export {
  ApiError,
};
