/**
 * Tests for SendTransactionWizard component
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { SendTransactionWizard } from '../../../components/send/SendTransactionWizard';
import { WalletType } from '../../../types';
import * as SendContext from '../../../contexts/send';
import * as useSendTransactionActionsHook from '../../../hooks/useSendTransactionActions';
import * as useHardwareWalletHook from '../../../hooks/useHardwareWallet';

// Mock logger
vi.mock('../../../utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Mock context
vi.mock('../../../contexts/send', () => ({
  SendTransactionProvider: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  useSendTransaction: vi.fn(),
}));

// Mock hooks
vi.mock('../../../hooks/useSendTransactionActions', () => ({
  useSendTransactionActions: vi.fn(),
}));

vi.mock('../../../hooks/useHardwareWallet', () => ({
  useHardwareWallet: vi.fn(),
}));

// Mock step components
vi.mock('../../../components/send/steps', () => ({
  TypeSelection: () => <div data-testid="type-selection">Type Selection</div>,
  OutputsStep: () => <div data-testid="outputs-step">Outputs Step</div>,
  ReviewStep: (props: any) => (
    <div data-testid="review-step">
      Review Step
      {props.error && <span data-testid="review-error">{props.error}</span>}
      {props.onBroadcast && <button data-testid="broadcast-btn" onClick={props.onBroadcast}>Broadcast</button>}
      {props.onSign && <button data-testid="sign-btn" onClick={props.onSign}>Sign</button>}
      {props.onSaveDraft && <button data-testid="save-draft-btn" onClick={props.onSaveDraft}>Save Draft</button>}
      {props.onBroadcastSigned && (
        <button data-testid="broadcast-signed-btn" onClick={props.onBroadcastSigned}>
          Broadcast Signed
        </button>
      )}
    </div>
  ),
}));

vi.mock('../../../components/send/WizardNavigation', () => ({
  WizardNavigation: () => <div data-testid="wizard-nav">Navigation</div>,
}));

describe('SendTransactionWizard', () => {
  const mockWallet = {
    id: 'wallet-1',
    name: 'Test Wallet',
    type: WalletType.SINGLE_SIG,
    balance: 100000,
    scriptType: 'native_segwit',
  };

  const mockUtxos = [
    { txid: 'abc123', vout: 0, address: 'bc1q...', amount: 50000, confirmations: 10 },
  ];

  const mockDevices = [
    { id: 'device-1', type: 'ledger', label: 'My Ledger', fingerprint: 'ABC123' },
  ];

  const mockFees = {
    fastestFee: 50,
    halfHourFee: 25,
    hourFee: 10,
    economyFee: 5,
    minimumFee: 1,
  };

  const defaultContextValue = {
    currentStep: 'type' as const,
    wallet: mockWallet,
    state: {
      outputs: [{ address: '', amount: '', sendMax: false }],
      selectedUTXOs: new Set<string>(),
      feeRate: 10,
      rbfEnabled: true,
      isDraftMode: false,
    },
    utxos: mockUtxos,
    devices: mockDevices,
    isReadyToSign: false,
  };

  const defaultActionsValue = {
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
  };

  const defaultHardwareWallet = {
    isConnected: false,
    device: null,
    signPSBT: vi.fn(),
    connect: vi.fn(),
    disconnect: vi.fn(),
  };

  const defaultProps = {
    walletId: 'wallet-1',
    wallet: mockWallet as any,
    utxos: mockUtxos as any,
    fees: mockFees,
    mempoolBlocks: [],
    queuedBlocksSummary: null,
    walletAddresses: [],
    devices: mockDevices as any,
    onCancel: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(SendContext.useSendTransaction).mockReturnValue(defaultContextValue as any);
    vi.mocked(useSendTransactionActionsHook.useSendTransactionActions).mockReturnValue(defaultActionsValue as any);
    vi.mocked(useHardwareWalletHook.useHardwareWallet).mockReturnValue(defaultHardwareWallet as any);
  });

  const renderWizard = (props = {}) => {
    return render(
      <MemoryRouter>
        <SendTransactionWizard {...defaultProps} {...props} />
      </MemoryRouter>
    );
  };

  describe('rendering', () => {
    it('renders wizard header with wallet name', () => {
      renderWizard();

      expect(screen.getByText(/Send from Test Wallet/)).toBeInTheDocument();
    });

    it('renders cancel button', () => {
      renderWizard();

      expect(screen.getByText('Cancel')).toBeInTheDocument();
    });

    it('renders type selection step initially', () => {
      renderWizard();

      expect(screen.getByTestId('type-selection')).toBeInTheDocument();
    });
  });

  describe('step navigation', () => {
    it('renders outputs step when currentStep is outputs', () => {
      vi.mocked(SendContext.useSendTransaction).mockReturnValue({
        ...defaultContextValue,
        currentStep: 'outputs',
      } as any);

      renderWizard();

      expect(screen.getByTestId('outputs-step')).toBeInTheDocument();
    });

    it('renders review step when currentStep is review', () => {
      vi.mocked(SendContext.useSendTransaction).mockReturnValue({
        ...defaultContextValue,
        currentStep: 'review',
        isReadyToSign: true,
      } as any);

      renderWizard();

      expect(screen.getByTestId('review-step')).toBeInTheDocument();
    });
  });

  describe('cancel action', () => {
    it('calls onCancel when clicking cancel button', async () => {
      const user = userEvent.setup();
      const onCancel = vi.fn();
      renderWizard({ onCancel });

      await user.click(screen.getByText('Cancel'));

      expect(onCancel).toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    it('displays error message when actions have error', () => {
      vi.mocked(useSendTransactionActionsHook.useSendTransactionActions).mockReturnValue({
        ...defaultActionsValue,
        error: 'Failed to create transaction',
      } as any);

      renderWizard();

      expect(screen.getByText('Failed to create transaction')).toBeInTheDocument();
    });

    it('has dismiss button when error is displayed', () => {
      vi.mocked(useSendTransactionActionsHook.useSendTransactionActions).mockReturnValue({
        ...defaultActionsValue,
        error: 'Network error',
      } as any);

      renderWizard();

      expect(screen.getByText(/dismiss/i)).toBeInTheDocument();
    });
  });

  describe('single-sig flow', () => {
    it('renders broadcast button on review step for single-sig', () => {
      vi.mocked(SendContext.useSendTransaction).mockReturnValue({
        ...defaultContextValue,
        currentStep: 'review',
        wallet: { ...mockWallet, type: WalletType.SINGLE_SIG },
        isReadyToSign: true,
      } as any);

      renderWizard();

      expect(screen.getByTestId('broadcast-btn')).toBeInTheDocument();
    });

    it('does not render separate sign button for single-sig', () => {
      vi.mocked(SendContext.useSendTransaction).mockReturnValue({
        ...defaultContextValue,
        currentStep: 'review',
        wallet: { ...mockWallet, type: WalletType.SINGLE_SIG },
        isReadyToSign: true,
      } as any);

      renderWizard();

      expect(screen.queryByTestId('sign-btn')).not.toBeInTheDocument();
    });
  });

  describe('multi-sig flow', () => {
    it('renders sign button on review step for multi-sig', () => {
      vi.mocked(SendContext.useSendTransaction).mockReturnValue({
        ...defaultContextValue,
        currentStep: 'review',
        wallet: { ...mockWallet, type: WalletType.MULTI_SIG },
        isReadyToSign: true,
      } as any);

      renderWizard({ wallet: { ...mockWallet, type: 'multisig:2/3' } });

      expect(screen.getByTestId('sign-btn')).toBeInTheDocument();
    });

    it('does not render broadcast button for multi-sig', () => {
      vi.mocked(SendContext.useSendTransaction).mockReturnValue({
        ...defaultContextValue,
        currentStep: 'review',
        wallet: { ...mockWallet, type: WalletType.MULTI_SIG },
        isReadyToSign: true,
      } as any);

      renderWizard({ wallet: { ...mockWallet, type: 'multisig:2/3' } });

      expect(screen.queryByTestId('broadcast-btn')).not.toBeInTheDocument();
    });
  });

  describe('draft mode', () => {
    it('does not render save draft button in draft mode', () => {
      vi.mocked(SendContext.useSendTransaction).mockReturnValue({
        ...defaultContextValue,
        currentStep: 'review',
        state: {
          ...defaultContextValue.state,
          isDraftMode: true,
          unsignedPsbt: 'cHNidP8...',
        },
        isReadyToSign: true,
      } as any);

      renderWizard();

      expect(screen.queryByTestId('save-draft-btn')).not.toBeInTheDocument();
    });

    it('renders save draft button when not in draft mode', () => {
      vi.mocked(SendContext.useSendTransaction).mockReturnValue({
        ...defaultContextValue,
        currentStep: 'review',
        state: {
          ...defaultContextValue.state,
          isDraftMode: false,
        },
        isReadyToSign: true,
      } as any);

      renderWizard();

      expect(screen.getByTestId('save-draft-btn')).toBeInTheDocument();
    });

    it('calls saveDraft when save draft button is clicked', async () => {
      const user = userEvent.setup();
      const saveDraft = vi.fn();
      vi.mocked(useSendTransactionActionsHook.useSendTransactionActions).mockReturnValue({
        ...defaultActionsValue,
        saveDraft,
      } as any);

      vi.mocked(SendContext.useSendTransaction).mockReturnValue({
        ...defaultContextValue,
        currentStep: 'review',
        state: {
          ...defaultContextValue.state,
          isDraftMode: false,
        },
        isReadyToSign: true,
      } as any);

      renderWizard();
      await user.click(screen.getByTestId('save-draft-btn'));
      expect(saveDraft).toHaveBeenCalledTimes(1);
    });
  });

  describe('auto-create transaction', () => {
    it('creates transaction when entering review step', async () => {
      const createTransaction = vi.fn();
      vi.mocked(useSendTransactionActionsHook.useSendTransactionActions).mockReturnValue({
        ...defaultActionsValue,
        createTransaction,
      } as any);

      vi.mocked(SendContext.useSendTransaction).mockReturnValue({
        ...defaultContextValue,
        currentStep: 'review',
        isReadyToSign: true,
      } as any);

      renderWizard();

      await waitFor(() => {
        expect(createTransaction).toHaveBeenCalled();
      });
    });

    it('does not create transaction in draft mode', async () => {
      const createTransaction = vi.fn();
      vi.mocked(useSendTransactionActionsHook.useSendTransactionActions).mockReturnValue({
        ...defaultActionsValue,
        createTransaction,
      } as any);

      vi.mocked(SendContext.useSendTransaction).mockReturnValue({
        ...defaultContextValue,
        currentStep: 'review',
        state: {
          ...defaultContextValue.state,
          isDraftMode: true,
        },
        isReadyToSign: true,
      } as any);

      renderWizard();

      // Should not auto-create in draft mode
      expect(createTransaction).not.toHaveBeenCalled();
    });
  });

  describe('review callbacks', () => {
    it('calls broadcastTransaction from onBroadcastSigned callback', async () => {
      const user = userEvent.setup();
      const broadcastTransaction = vi.fn();
      vi.mocked(useSendTransactionActionsHook.useSendTransactionActions).mockReturnValue({
        ...defaultActionsValue,
        broadcastTransaction,
      } as any);

      vi.mocked(SendContext.useSendTransaction).mockReturnValue({
        ...defaultContextValue,
        currentStep: 'review',
        isReadyToSign: true,
      } as any);

      renderWizard();
      await user.click(screen.getByTestId('broadcast-signed-btn'));
      expect(broadcastTransaction).toHaveBeenCalledTimes(1);
    });
  });

  describe('hardware wallet signing', () => {
    it('signs with hardware wallet when connected', async () => {
      const user = userEvent.setup();
      const signPSBT = vi.fn().mockResolvedValue({ psbt: 'signed...' });
      const broadcastTransaction = vi.fn();

      vi.mocked(useHardwareWalletHook.useHardwareWallet).mockReturnValue({
        isConnected: true,
        device: { id: 'hw-1', type: 'ledger' },
        signPSBT,
      } as any);

      vi.mocked(useSendTransactionActionsHook.useSendTransactionActions).mockReturnValue({
        ...defaultActionsValue,
        txData: { psbtBase64: 'unsigned...' },
        broadcastTransaction,
      } as any);

      vi.mocked(SendContext.useSendTransaction).mockReturnValue({
        ...defaultContextValue,
        currentStep: 'review',
        isReadyToSign: true,
      } as any);

      renderWizard();

      await user.click(screen.getByTestId('broadcast-btn'));

      await waitFor(() => {
        expect(signPSBT).toHaveBeenCalled();
      });
    });

    it('broadcasts signed raw transaction directly when available', async () => {
      const user = userEvent.setup();
      const broadcastTransaction = vi.fn();
      const createTransaction = vi.fn();

      vi.mocked(useSendTransactionActionsHook.useSendTransactionActions).mockReturnValue({
        ...defaultActionsValue,
        txData: { psbtBase64: 'already-created' },
        signedRawTx: '0200000001deadbeef',
        createTransaction,
        broadcastTransaction,
      } as any);

      vi.mocked(SendContext.useSendTransaction).mockReturnValue({
        ...defaultContextValue,
        currentStep: 'review',
        isReadyToSign: true,
      } as any);

      renderWizard();
      await user.click(screen.getByTestId('broadcast-btn'));

      expect(broadcastTransaction).toHaveBeenCalledWith(undefined, '0200000001deadbeef');
      expect(createTransaction).not.toHaveBeenCalled();
    });

    it('creates transaction when txData is missing and broadcasts uploaded signed PSBT', async () => {
      const user = userEvent.setup();
      const createTransaction = vi.fn().mockResolvedValue({ psbtBase64: 'unsigned-from-create' });
      const broadcastTransaction = vi.fn();

      vi.mocked(useSendTransactionActionsHook.useSendTransactionActions).mockReturnValue({
        ...defaultActionsValue,
        txData: null,
        signedDevices: new Set(['device-1']),
        unsignedPsbt: 'signed-psbt',
        createTransaction,
        broadcastTransaction,
      } as any);

      vi.mocked(SendContext.useSendTransaction).mockReturnValue({
        ...defaultContextValue,
        currentStep: 'review',
        isReadyToSign: true,
      } as any);

      renderWizard();
      await user.click(screen.getByTestId('broadcast-btn'));

      await waitFor(() => {
        expect(createTransaction).toHaveBeenCalled();
      });
      expect(broadcastTransaction).toHaveBeenCalledWith('signed-psbt');
    });

    it('creates PSBT for external signing when no signing method is available', async () => {
      const user = userEvent.setup();
      const createTransaction = vi.fn().mockResolvedValue({ psbtBase64: 'unsigned-created' });
      const broadcastTransaction = vi.fn();

      vi.mocked(useSendTransactionActionsHook.useSendTransactionActions).mockReturnValue({
        ...defaultActionsValue,
        txData: { psbtBase64: 'already-created' },
        signedDevices: new Set<string>(),
        unsignedPsbt: null,
        createTransaction,
        broadcastTransaction,
      } as any);

      vi.mocked(SendContext.useSendTransaction).mockReturnValue({
        ...defaultContextValue,
        currentStep: 'review',
        isReadyToSign: true,
      } as any);

      renderWizard();
      await user.click(screen.getByTestId('broadcast-btn'));

      await waitFor(() => {
        expect(createTransaction).toHaveBeenCalledTimes(1);
      });
      expect(broadcastTransaction).not.toHaveBeenCalled();
    });
  });

  describe('step transitions', () => {
    it('resets actions when leaving review step in non-draft mode', async () => {
      const reset = vi.fn();
      const contextReview = {
        ...defaultContextValue,
        currentStep: 'review' as const,
        isReadyToSign: true,
        state: {
          ...defaultContextValue.state,
          isDraftMode: false,
        },
      };
      const contextOutputs = {
        ...contextReview,
        currentStep: 'outputs' as const,
      };

      vi.mocked(SendContext.useSendTransaction)
        .mockReturnValueOnce(contextReview as any)
        .mockReturnValueOnce(contextOutputs as any);
      vi.mocked(useSendTransactionActionsHook.useSendTransactionActions).mockReturnValue({
        ...defaultActionsValue,
        reset,
      } as any);

      const view = renderWizard();
      view.rerender(
        <MemoryRouter>
          <SendTransactionWizard {...defaultProps} />
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(reset).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe('loading states', () => {
    it('passes signing state to review step', () => {
      vi.mocked(useSendTransactionActionsHook.useSendTransactionActions).mockReturnValue({
        ...defaultActionsValue,
        isSigning: true,
      } as any);

      vi.mocked(SendContext.useSendTransaction).mockReturnValue({
        ...defaultContextValue,
        currentStep: 'review',
        isReadyToSign: true,
      } as any);

      renderWizard();

      expect(screen.getByTestId('review-step')).toBeInTheDocument();
    });

    it('passes broadcasting state to review step', () => {
      vi.mocked(useSendTransactionActionsHook.useSendTransactionActions).mockReturnValue({
        ...defaultActionsValue,
        isBroadcasting: true,
      } as any);

      vi.mocked(SendContext.useSendTransaction).mockReturnValue({
        ...defaultContextValue,
        currentStep: 'review',
        isReadyToSign: true,
      } as any);

      renderWizard();

      expect(screen.getByTestId('review-step')).toBeInTheDocument();
    });
  });
});
