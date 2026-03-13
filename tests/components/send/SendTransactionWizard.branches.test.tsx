import { render,screen,waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach,describe,expect,it,vi } from 'vitest';
import { SendTransactionWizard } from '../../../components/send/SendTransactionWizard';
import { WalletType } from '../../../types';

const useSendTransactionMock = vi.hoisted(() => vi.fn());
const useSendTransactionActionsMock = vi.hoisted(() => vi.fn());
const useHardwareWalletMock = vi.hoisted(() => vi.fn());

vi.mock('../../../utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('../../../contexts/send', () => ({
  SendTransactionProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useSendTransaction: () => useSendTransactionMock(),
}));

vi.mock('../../../hooks/send/useSendTransactionActions', () => ({
  useSendTransactionActions: (args: any) => useSendTransactionActionsMock(args),
}));

vi.mock('../../../hooks/useHardwareWallet', () => ({
  useHardwareWallet: () => useHardwareWalletMock(),
}));

vi.mock('../../../components/send/WizardNavigation', () => ({
  WizardNavigation: () => <div data-testid="wizard-nav" />,
}));

vi.mock('../../../components/send/steps', () => ({
  TypeSelection: () => <div data-testid="type-step" />,
  OutputsStep: () => <div data-testid="outputs-step" />,
  ReviewStep: (props: any) => (
    <div data-testid="review-step">
      {props.onBroadcast && (
        <button onClick={props.onBroadcast}>broadcast</button>
      )}
      {props.onSign && (
        <button onClick={props.onSign}>sign</button>
      )}
    </div>
  ),
}));

describe('SendTransactionWizard branch coverage', () => {
  const wallet = {
    id: 'wallet-1',
    name: 'Wallet One',
    type: WalletType.SINGLE_SIG,
    balance: 100000,
    scriptType: 'native_segwit',
  };

  const baseUtxo = {
    txid: 'known',
    vout: 0,
    address: 'bc1q-known',
    amount: 50000,
    confirmations: 5,
  };

  const makeContext = (overrides: any = {}) => ({
    currentStep: 'type',
    wallet,
    state: {
      outputs: [{ address: 'bc1q-dest', amount: '1000', sendMax: false }],
      selectedUTXOs: new Set<string>(),
      feeRate: 10,
      rbfEnabled: true,
      isDraftMode: false,
      unsignedPsbt: null,
    },
    devices: [],
    utxos: [baseUtxo],
    isReadyToSign: false,
    ...overrides,
  });

  const makeActions = (overrides: any = {}) => ({
    txData: null,
    unsignedPsbt: null,
    signedRawTx: null,
    signedDevices: new Set<string>(),
    payjoinStatus: 'idle',
    isCreating: false,
    isSigning: false,
    isBroadcasting: false,
    isSavingDraft: false,
    error: null,
    createTransaction: vi.fn(),
    broadcastTransaction: vi.fn(),
    saveDraft: vi.fn(),
    signWithDevice: vi.fn(),
    markDeviceSigned: vi.fn(),
    uploadSignedPsbt: vi.fn(),
    downloadPsbt: vi.fn(),
    processQrSignedPsbt: vi.fn(),
    clearError: vi.fn(),
    reset: vi.fn(),
    ...overrides,
  });

  const makeHardware = (overrides: any = {}) => ({
    isConnected: false,
    device: null,
    signPSBT: vi.fn(),
    ...overrides,
  });

  const renderWizard = (props: any = {}) =>
    render(
      <MemoryRouter>
        <SendTransactionWizard
          wallet={wallet as any}
          devices={[] as any}
          utxos={[baseUtxo] as any}
          walletAddresses={[]}
          fees={{
            fastestFee: 25,
            halfHourFee: 15,
            hourFee: 10,
            economyFee: 5,
            minimumFee: 1,
          }}
          onCancel={vi.fn()}
          {...props}
        />
      </MemoryRouter>
    );

  beforeEach(() => {
    vi.clearAllMocks();
    useSendTransactionMock.mockReturnValue(makeContext());
    useSendTransactionActionsMock.mockReturnValue(makeActions());
    useHardwareWalletMock.mockReturnValue(makeHardware());
  });

  it('builds draft initial tx data with fallback address/amount and invalid output amount handling', () => {
    useSendTransactionMock.mockReturnValue(
      makeContext({
        state: {
          outputs: [{ address: 'bc1q-draft', amount: 'not-a-number', sendMax: false }],
          selectedUTXOs: new Set<string>(),
          feeRate: 10,
          rbfEnabled: true,
          isDraftMode: true,
          unsignedPsbt: 'unsigned-draft-psbt',
        },
      })
    );

    renderWizard({
      draftTxData: {
        fee: 100,
        totalInput: 1000,
        totalOutput: 900,
        changeAmount: 100,
        effectiveAmount: 900,
        selectedUtxoIds: ['known:1'],
      },
    });

    const hookArgs = useSendTransactionActionsMock.mock.calls[0][0];
    expect(hookArgs.initialTxData.utxos).toEqual([
      { txid: 'known', vout: 1, address: '', amount: 0 },
    ]);
    expect(hookArgs.initialTxData.outputs).toEqual([
      { address: 'bc1q-draft', amount: 0 },
    ]);
  });

  it('keeps draft initial tx data undefined when draftData is missing', () => {
    useSendTransactionMock.mockReturnValue(
      makeContext({
        state: {
          outputs: [{ address: 'bc1q-dest', amount: '1000', sendMax: false }],
          selectedUTXOs: new Set<string>(),
          feeRate: 10,
          rbfEnabled: true,
          isDraftMode: true,
          unsignedPsbt: 'unsigned-draft-psbt',
        },
      })
    );

    renderWizard();
    const hookArgs = useSendTransactionActionsMock.mock.calls[0][0];
    expect(hookArgs.initialTxData).toBeUndefined();
  });

  it('keeps draft initial tx data undefined when unsigned PSBT is missing', () => {
    useSendTransactionMock.mockReturnValue(
      makeContext({
        state: {
          outputs: [{ address: 'bc1q-dest', amount: '1000', sendMax: false }],
          selectedUTXOs: new Set<string>(),
          feeRate: 10,
          rbfEnabled: true,
          isDraftMode: true,
          unsignedPsbt: null,
        },
      })
    );

    renderWizard({
      draftTxData: {
        fee: 100,
        totalInput: 1000,
        totalOutput: 900,
        changeAmount: 100,
        effectiveAmount: 900,
        selectedUtxoIds: ['known:0'],
      },
    });

    const hookArgs = useSendTransactionActionsMock.mock.calls[0][0];
    expect(hookArgs.initialTxData).toBeUndefined();
  });

  it('returns early from single-sig broadcast when createTransaction resolves null', async () => {
    const user = userEvent.setup();
    const createTransaction = vi.fn().mockResolvedValue(null);
    const broadcastTransaction = vi.fn();

    useSendTransactionMock.mockReturnValue(
      makeContext({
        currentStep: 'review',
        isReadyToSign: false,
      })
    );
    useSendTransactionActionsMock.mockReturnValue(
      makeActions({
        txData: null,
        createTransaction,
        broadcastTransaction,
      })
    );

    renderWizard();
    await user.click(screen.getByRole('button', { name: 'broadcast' }));

    await waitFor(() => {
      expect(createTransaction).toHaveBeenCalledTimes(1);
    });
    expect(broadcastTransaction).not.toHaveBeenCalled();
  });

  it('does not broadcast when hardware signing returns no PSBT/rawTx', async () => {
    const user = userEvent.setup();
    const broadcastTransaction = vi.fn();
    const signPSBT = vi.fn().mockResolvedValue({});

    useSendTransactionMock.mockReturnValue(
      makeContext({
        currentStep: 'review',
        isReadyToSign: true,
      })
    );
    useSendTransactionActionsMock.mockReturnValue(
      makeActions({
        txData: { psbtBase64: 'unsigned-psbt' },
        broadcastTransaction,
      })
    );
    useHardwareWalletMock.mockReturnValue(
      makeHardware({
        isConnected: true,
        device: { id: 'hw-1' },
        signPSBT,
      })
    );

    renderWizard();
    await user.click(screen.getByRole('button', { name: 'broadcast' }));

    expect(signPSBT).toHaveBeenCalledWith('unsigned-psbt');
    expect(broadcastTransaction).not.toHaveBeenCalled();
  });

  it('skips creating a transaction when unsigned PSBT already exists without a signing method', async () => {
    const user = userEvent.setup();
    const createTransaction = vi.fn();
    const broadcastTransaction = vi.fn();

    useSendTransactionMock.mockReturnValue(
      makeContext({
        currentStep: 'review',
        isReadyToSign: true,
      })
    );
    useSendTransactionActionsMock.mockReturnValue(
      makeActions({
        txData: { psbtBase64: 'existing-tx' },
        unsignedPsbt: 'already-unsigned',
        signedDevices: new Set<string>(),
        createTransaction,
        broadcastTransaction,
      })
    );

    renderWizard();
    await user.click(screen.getByRole('button', { name: 'broadcast' }));

    expect(createTransaction).not.toHaveBeenCalled();
    expect(broadcastTransaction).not.toHaveBeenCalled();
  });

  it('does not create transaction in multi-sig sign handler when txData already exists', async () => {
    const user = userEvent.setup();
    const createTransaction = vi.fn();

    useSendTransactionMock.mockReturnValue(
      makeContext({
        currentStep: 'review',
        wallet: { ...wallet, type: WalletType.MULTI_SIG },
        isReadyToSign: false,
      })
    );
    useSendTransactionActionsMock.mockReturnValue(
      makeActions({
        txData: { psbtBase64: 'existing-tx' },
        createTransaction,
      })
    );

    renderWizard({
      wallet: { ...wallet, type: WalletType.MULTI_SIG },
    });
    await user.click(screen.getByRole('button', { name: 'sign' }));

    expect(createTransaction).not.toHaveBeenCalled();
  });

  it('creates transaction in multi-sig sign handler when txData is missing', async () => {
    const user = userEvent.setup();
    const createTransaction = vi.fn().mockResolvedValue({ psbtBase64: 'created' });

    useSendTransactionMock.mockReturnValue(
      makeContext({
        currentStep: 'review',
        wallet: { ...wallet, type: WalletType.MULTI_SIG },
        isReadyToSign: true,
      })
    );
    useSendTransactionActionsMock.mockReturnValue(
      makeActions({
        txData: null,
        createTransaction,
      })
    );

    renderWizard({
      wallet: { ...wallet, type: WalletType.MULTI_SIG },
    });
    await user.click(screen.getByRole('button', { name: 'sign' }));

    await waitFor(() => {
      expect(createTransaction).toHaveBeenCalled();
    });
  });

  it('renders null step content for unknown step values', () => {
    useSendTransactionMock.mockReturnValue(
      makeContext({
        currentStep: 'unexpected-step',
      })
    );

    renderWizard();

    expect(screen.queryByTestId('type-step')).not.toBeInTheDocument();
    expect(screen.queryByTestId('outputs-step')).not.toBeInTheDocument();
    expect(screen.queryByTestId('review-step')).not.toBeInTheDocument();
  });
});
