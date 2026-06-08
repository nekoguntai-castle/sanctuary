/**
 * Tests for ReviewStep component
 */

import { render,screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach,describe,expect,it,vi } from 'vitest';
import { ReviewStep } from '../../../components/send/steps/ReviewStep';
import * as CurrencyContext from '../../../contexts/CurrencyContext';
import * as SendContext from '../../../contexts/send';

vi.mock('../../../utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Mock the contexts
vi.mock('../../../contexts/send', () => ({
  useSendTransaction: vi.fn(),
}));

vi.mock('../../../contexts/CurrencyContext', () => ({
  useCurrency: vi.fn(),
  usePriceFreeFormatter: vi.fn(),
}));

// Mock child components
vi.mock('../../../components/TransactionFlowPreview', () => ({
  TransactionFlowPreview: () => <div data-testid="tx-flow-preview">Flow Preview</div>,
}));

vi.mock('../../../components/FiatDisplay', () => ({
  FiatDisplay: ({ sats }: { sats: number }) => <span data-testid="fiat-display">${(sats / 100000000 * 50000).toFixed(2)}</span>,
}));

vi.mock('../../../components/qr', () => ({
  QRSigningModal: ({ isOpen, onClose, onSignedPsbt }: any) =>
    isOpen ? (
      <div data-testid="qr-signing-modal">
        <button data-testid="close-qr-modal" onClick={onClose}>Close</button>
        <button data-testid="submit-signed-psbt" onClick={() => onSignedPsbt('signed-psbt-data')}>Submit</button>
      </div>
    ) : null,
}));

vi.mock('../../../components/ui/Button', () => ({
  Button: ({ children, onClick, disabled, isLoading, className }: any) => (
    <button onClick={onClick} disabled={disabled || isLoading} className={className}>
      {isLoading ? 'Loading...' : children}
    </button>
  ),
}));

// Mock API
vi.mock('../../../src/api/bitcoin', () => ({
  lookupAddresses: vi.fn().mockImplementation(() => new Promise(() => {})),
}));

describe('ReviewStep', () => {
  const mockGoToStep = vi.fn();
  const mockPrevStep = vi.fn();

  const defaultContext = {
    state: {
      transactionType: 'standard' as const,
      outputs: [{ address: 'bc1qtest...', amount: '50000', sendMax: false }],
      selectedUTXOs: new Set<string>(['abc123:0']),
      showCoinControl: true,
      feeRate: 25,
      rbfEnabled: true,
      useDecoys: false,
      decoyCount: 2,
      payjoinUrl: null,
    },
    wallet: { id: 'wallet-1', name: 'Test Wallet', type: 'native_segwit', quorum: 1 },
    devices: [
      { id: 'device-1', type: 'ledger', label: 'My Ledger', fingerprint: 'ABC123' },
    ],
    utxos: [
      { txid: 'abc123', vout: 0, address: 'bc1qsource...', amount: 100000 },
    ],
    spendableUtxos: [
      { txid: 'abc123', vout: 0, address: 'bc1qsource...', amount: 100000 },
    ],
    walletAddresses: [],
    selectedTotal: 100000,
    estimatedFee: 1000,
    totalOutputAmount: 50000,
    goToStep: mockGoToStep,
    prevStep: mockPrevStep,
    isReadyToSign: true,
  };

  const defaultCurrencyContext = {
    format: (sats: number) => `${sats} sats`,
    formatFiat: () => '$50.00',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(SendContext.useSendTransaction).mockReturnValue(defaultContext as any);
    vi.mocked(CurrencyContext.useCurrency).mockReturnValue(defaultCurrencyContext as any);
    vi.mocked(CurrencyContext.usePriceFreeFormatter).mockReturnValue(defaultCurrencyContext as any);
  });

  describe('Rendering', () => {
    it('renders header', () => {
      render(<ReviewStep />);

      expect(screen.getByText('Review Transaction')).toBeInTheDocument();
      expect(screen.getByText('Please verify all details before signing')).toBeInTheDocument();
    });

    it('renders draft mode header when isDraftMode is true', () => {
      render(<ReviewStep isDraftMode={true} />);

      expect(screen.getByText('Resume Draft')).toBeInTheDocument();
      expect(screen.getByText('Sign and broadcast this saved transaction')).toBeInTheDocument();
      expect(screen.getByText('Saved Draft - Parameters Locked')).toBeInTheDocument();
    });

    it('renders transaction flow preview when data available', () => {
      render(<ReviewStep />);

      expect(screen.getByTestId('tx-flow-preview')).toBeInTheDocument();
    });

    it('renders transaction type badge', () => {
      render(<ReviewStep />);

      expect(screen.getByText('Standard Send')).toBeInTheDocument();
    });

    it('renders consolidation type badge', () => {
      vi.mocked(SendContext.useSendTransaction).mockReturnValue({
        ...defaultContext,
        state: { ...defaultContext.state, transactionType: 'consolidation' },
      } as any);

      render(<ReviewStep />);

      expect(screen.getByText('Consolidation')).toBeInTheDocument();
    });

    it('renders sweep type badge', () => {
      vi.mocked(SendContext.useSendTransaction).mockReturnValue({
        ...defaultContext,
        state: { ...defaultContext.state, transactionType: 'sweep' },
      } as any);

      render(<ReviewStep />);

      expect(screen.getByText('Sweep')).toBeInTheDocument();
    });
  });

  describe('Recipients section', () => {
    it('renders recipient address', () => {
      render(<ReviewStep />);

      expect(screen.getByText('bc1qtest...')).toBeInTheDocument();
    });

    it('renders recipient amount', () => {
      render(<ReviewStep />);

      expect(screen.getAllByText('50000 sats').length).toBeGreaterThan(0);
    });

    it('renders MAX for sendMax outputs', () => {
      vi.mocked(SendContext.useSendTransaction).mockReturnValue({
        ...defaultContext,
        state: {
          ...defaultContext.state,
          outputs: [{ address: 'bc1qtest...', amount: '0', sendMax: true }],
        },
      } as any);

      render(<ReviewStep />);

      expect(screen.getByText('MAX')).toBeInTheDocument();
    });

    it('renders multiple recipients', () => {
      vi.mocked(SendContext.useSendTransaction).mockReturnValue({
        ...defaultContext,
        state: {
          ...defaultContext.state,
          outputs: [
            { address: 'bc1qrecipient1...', amount: '25000', sendMax: false },
            { address: 'bc1qrecipient2...', amount: '25000', sendMax: false },
          ],
        },
      } as any);

      render(<ReviewStep />);

      expect(screen.getByText('Recipients (2)')).toBeInTheDocument();
    });

    it('shows payjoin status when enabled', () => {
      vi.mocked(SendContext.useSendTransaction).mockReturnValue({
        ...defaultContext,
        state: {
          ...defaultContext.state,
          payjoinUrl: 'https://payjoin.example.com',
        },
      } as any);

      render(<ReviewStep payjoinStatus="success" />);

      expect(screen.getByText(/Payjoin active/)).toBeInTheDocument();
    });
  });

  describe('Amounts section', () => {
    it('renders total sending amount', () => {
      render(<ReviewStep />);

      expect(screen.getByText('Total Sending')).toBeInTheDocument();
    });

    it('renders network fee', () => {
      render(<ReviewStep />);

      expect(screen.getByText('Network Fee')).toBeInTheDocument();
      expect(screen.getByText('25 sat/vB')).toBeInTheDocument();
    });

    it('renders change amount when applicable', () => {
      render(<ReviewStep />);

      expect(screen.getByText('49000 sats')).toBeInTheDocument();
    });

    it('renders total including fee', () => {
      render(<ReviewStep />);

      expect(screen.getByText('Total (including fee)')).toBeInTheDocument();
    });
  });

  describe('Options summary', () => {
    it('shows RBF status', () => {
      render(<ReviewStep />);

      expect(screen.getByText('RBF (Replace-By-Fee)')).toBeInTheDocument();
      expect(screen.getByText('Enabled')).toBeInTheDocument();
    });

    it('shows disabled RBF status', () => {
      vi.mocked(SendContext.useSendTransaction).mockReturnValue({
        ...defaultContext,
        state: { ...defaultContext.state, rbfEnabled: false },
      } as any);

      render(<ReviewStep />);

      expect(screen.getByText('Disabled')).toBeInTheDocument();
    });

    it('shows decoy outputs when enabled', () => {
      vi.mocked(SendContext.useSendTransaction).mockReturnValue({
        ...defaultContext,
        state: { ...defaultContext.state, useDecoys: true, decoyCount: 3 },
      } as any);

      render(<ReviewStep />);

      expect(screen.getByText('Decoy Outputs')).toBeInTheDocument();
      expect(screen.getByText('3 decoys')).toBeInTheDocument();
    });

    it('shows coin control status when enabled', () => {
      render(<ReviewStep />);

      expect(screen.getByText('Coin Control')).toBeInTheDocument();
      expect(screen.getByText(/1 UTXO selected/)).toBeInTheDocument();
    });
  });

  describe('Edit functionality', () => {
    it('calls goToStep when clicking Change on type', async () => {
      const user = userEvent.setup();
      render(<ReviewStep />);

      const changeButtons = screen.getAllByRole('button', { name: 'Change' });
      await user.click(changeButtons[0]);

      expect(mockGoToStep).toHaveBeenCalledWith('type');
    });

    it('hides edit buttons in draft mode', () => {
      render(<ReviewStep isDraftMode={true} />);

      expect(screen.queryByRole('button', { name: 'Change' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
    });
  });

  describe('Navigation', () => {
    it('renders Back button', () => {
      render(<ReviewStep />);

      expect(screen.getByText('Back')).toBeInTheDocument();
    });

    it('calls prevStep when clicking Back', async () => {
      const user = userEvent.setup();
      render(<ReviewStep />);

      await user.click(screen.getByText('Back'));

      expect(mockPrevStep).toHaveBeenCalled();
    });

    it('hides Back button in draft mode', () => {
      render(<ReviewStep isDraftMode={true} />);

      expect(screen.queryByText('Back')).not.toBeInTheDocument();
    });
  });

  describe('Single-sig signing', () => {
    it('renders Sign & Broadcast button', () => {
      render(<ReviewStep txData={{} as any} />);

      expect(screen.getByText(/Sign & Broadcast/)).toBeInTheDocument();
    });

    it('calls onBroadcast when clicking Sign & Broadcast', async () => {
      const user = userEvent.setup();
      const onBroadcast = vi.fn();
      render(<ReviewStep onBroadcast={onBroadcast} txData={{} as any} />);

      await user.click(screen.getByText(/Sign & Broadcast/));

      expect(onBroadcast).toHaveBeenCalled();
    });

    it('disables Sign & Broadcast when not ready', () => {
      vi.mocked(SendContext.useSendTransaction).mockReturnValue({
        ...defaultContext,
        isReadyToSign: false,
      } as any);

      render(<ReviewStep txData={{} as any} />);

      expect(screen.getByText(/Sign & Broadcast/).closest('button')).toBeDisabled();
    });

    it('shows loading state when signing', () => {
      render(<ReviewStep signing={true} txData={{} as any} />);

      expect(screen.getByText('Loading...')).toBeInTheDocument();
    });

    it('renders Sign Transaction panel for single-sig with txData', () => {
      render(<ReviewStep txData={{} as any} unsignedPsbt="base64psbt" />);

      expect(screen.getByText('Sign Transaction')).toBeInTheDocument();
    });

    it('renders USB sign button for USB-capable devices', () => {
      render(<ReviewStep txData={{} as any} unsignedPsbt="base64psbt" />);

      expect(screen.getByText(/USB \(My Ledger\)/)).toBeInTheDocument();
    });

    it('calls onSignWithDevice when clicking USB button', async () => {
      const user = userEvent.setup();
      const onSignWithDevice = vi.fn().mockResolvedValue(true);
      render(<ReviewStep txData={{} as any} unsignedPsbt="base64psbt" onSignWithDevice={onSignWithDevice} />);

      await user.click(screen.getByText(/USB \(My Ledger\)/));

      expect(onSignWithDevice).toHaveBeenCalled();
    });

    it('shows signed PSBT message when uploaded', () => {
      render(<ReviewStep txData={{} as any} unsignedPsbt="base64psbt" signedDevices={new Set(['psbt-signed'])} />);

      expect(screen.getByText('Signed PSBT uploaded')).toBeInTheDocument();
    });
  });

  describe('Multi-sig signing', () => {
    const multisigContext = {
      ...defaultContext,
      wallet: { id: 'wallet-1', name: 'Test Wallet', type: 'multi_sig', quorum: { m: 2, n: 3 } },
      devices: [
        { id: 'device-1', type: 'coldcard', label: 'ColdCard 1', fingerprint: 'ABC123' },
        { id: 'device-2', type: 'ledger', label: 'Ledger 1', fingerprint: 'DEF456' },
        { id: 'device-3', type: 'passport', label: 'Passport 1', fingerprint: 'GHI789' },
      ],
    };

    it('renders multi-sig signing panel', () => {
      vi.mocked(SendContext.useSendTransaction).mockReturnValue(multisigContext as any);

      render(<ReviewStep txData={{} as any} unsignedPsbt="base64psbt" />);

      expect(screen.getByText('Signatures Required')).toBeInTheDocument();
      expect(screen.getByText('0 of 2')).toBeInTheDocument();
    });

    it('shows device signing cards', () => {
      vi.mocked(SendContext.useSendTransaction).mockReturnValue(multisigContext as any);

      render(<ReviewStep txData={{} as any} unsignedPsbt="base64psbt" />);

      expect(screen.getByText('ColdCard 1')).toBeInTheDocument();
      expect(screen.getByText('Ledger 1')).toBeInTheDocument();
      expect(screen.getByText('Passport 1')).toBeInTheDocument();
    });

    it('shows signed badge for signed devices', () => {
      vi.mocked(SendContext.useSendTransaction).mockReturnValue(multisigContext as any);

      render(
        <ReviewStep
          txData={{} as any}
          unsignedPsbt="base64psbt"
          signedDevices={new Set(['device-1'])}
        />
      );

      expect(screen.getByText('1 of 2')).toBeInTheDocument();
      expect(screen.getAllByText('Signed').length).toBeGreaterThan(0);
    });

    it('renders USB button for USB-capable devices', () => {
      vi.mocked(SendContext.useSendTransaction).mockReturnValue(multisigContext as any);

      render(<ReviewStep txData={{} as any} unsignedPsbt="base64psbt" />);

      expect(screen.getAllByRole('button', { name: 'USB' }).length).toBeGreaterThan(0);
    });

    it('renders QR Code button for QR-capable devices', () => {
      vi.mocked(SendContext.useSendTransaction).mockReturnValue(multisigContext as any);

      render(<ReviewStep txData={{} as any} unsignedPsbt="base64psbt" />);

      expect(screen.getAllByRole('button', { name: 'QR Code' }).length).toBeGreaterThan(0);
    });

    it('renders Download/Upload buttons for airgap devices', () => {
      vi.mocked(SendContext.useSendTransaction).mockReturnValue(multisigContext as any);

      render(<ReviewStep txData={{} as any} unsignedPsbt="base64psbt" />);

      expect(screen.getAllByText('Download').length).toBeGreaterThan(0);
      expect(screen.getAllByText('Upload').length).toBeGreaterThan(0);
    });

    it('shows Broadcast button when enough signatures', () => {
      vi.mocked(SendContext.useSendTransaction).mockReturnValue(multisigContext as any);

      render(
        <ReviewStep
          txData={{} as any}
          unsignedPsbt="base64psbt"
          signedDevices={new Set(['device-1', 'device-2'])}
        />
      );

      expect(screen.getByText('Broadcast Transaction')).toBeInTheDocument();
    });

    it('calls onBroadcastSigned when clicking Broadcast', async () => {
      const user = userEvent.setup();
      const onBroadcastSigned = vi.fn().mockResolvedValue(true);
      vi.mocked(SendContext.useSendTransaction).mockReturnValue(multisigContext as any);

      render(
        <ReviewStep
          txData={{} as any}
          unsignedPsbt="base64psbt"
          signedDevices={new Set(['device-1', 'device-2'])}
          onBroadcastSigned={onBroadcastSigned}
        />
      );

      await user.click(screen.getByText('Broadcast Transaction'));

      expect(onBroadcastSigned).toHaveBeenCalled();
    });
  });

  // Skip: QR Signing Modal tests require complex txData setup and modal integration
  // Better tested via E2E tests
  describe('QR Signing Modal', () => {
    it('opens QR modal when clicking QR Code button', async () => {
      const user = userEvent.setup();
      vi.mocked(SendContext.useSendTransaction).mockReturnValue({
        ...defaultContext,
        devices: [
          { id: 'device-1', type: 'passport', label: 'Passport', fingerprint: 'ABC123' },
        ],
      } as any);

      render(<ReviewStep txData={{} as any} unsignedPsbt="base64psbt" />);

      await user.click(screen.getByText(/QR Sign \(Passport\)/));

      expect(screen.getByTestId('qr-signing-modal')).toBeInTheDocument();
    });

    it('closes QR modal when clicking close', async () => {
      const user = userEvent.setup();
      vi.mocked(SendContext.useSendTransaction).mockReturnValue({
        ...defaultContext,
        devices: [
          { id: 'device-1', type: 'passport', label: 'Passport', fingerprint: 'ABC123' },
        ],
      } as any);

      render(<ReviewStep txData={{} as any} unsignedPsbt="base64psbt" />);

      await user.click(screen.getByText(/QR Sign \(Passport\)/));
      await user.click(screen.getByTestId('close-qr-modal'));

      expect(screen.queryByTestId('qr-signing-modal')).not.toBeInTheDocument();
    });

    it('calls onProcessQrSignedPsbt when submitting signed PSBT', async () => {
      const user = userEvent.setup();
      const onProcessQrSignedPsbt = vi.fn();
      vi.mocked(SendContext.useSendTransaction).mockReturnValue({
        ...defaultContext,
        devices: [
          { id: 'device-1', type: 'passport', label: 'Passport', fingerprint: 'ABC123' },
        ],
      } as any);

      render(
        <ReviewStep
          txData={{} as any}
          unsignedPsbt="base64psbt"
          onProcessQrSignedPsbt={onProcessQrSignedPsbt}
        />
      );

      await user.click(screen.getByText(/QR Sign \(Passport\)/));
      await user.click(screen.getByTestId('submit-signed-psbt'));

      expect(onProcessQrSignedPsbt).toHaveBeenCalledWith('signed-psbt-data', 'device-1');
    });
  });

  describe('Save Draft', () => {
    it('renders Save as Draft button when onSaveDraft provided', () => {
      render(<ReviewStep onSaveDraft={() => {}} />);

      expect(screen.getByText('Save as Draft')).toBeInTheDocument();
    });

    it('does not render Save as Draft button when onSaveDraft not provided', () => {
      render(<ReviewStep />);

      expect(screen.queryByText('Save as Draft')).not.toBeInTheDocument();
    });

    it('calls onSaveDraft when clicking Save as Draft', async () => {
      const user = userEvent.setup();
      const onSaveDraft = vi.fn();
      render(<ReviewStep onSaveDraft={onSaveDraft} />);

      await user.click(screen.getByText('Save as Draft'));

      expect(onSaveDraft).toHaveBeenCalled();
    });

    it('shows loading state when saving draft', () => {
      render(<ReviewStep onSaveDraft={() => {}} savingDraft={true} />);

      expect(screen.getAllByText('Loading...').length).toBeGreaterThan(0);
    });
  });

  describe('Validation warnings', () => {
    it('shows warning when not ready to sign', () => {
      vi.mocked(SendContext.useSendTransaction).mockReturnValue({
        ...defaultContext,
        isReadyToSign: false,
      } as any);

      render(<ReviewStep />);

      expect(screen.getByText('Please complete all required fields before signing.')).toBeInTheDocument();
    });

    it('hides warning when ready to sign', () => {
      render(<ReviewStep />);

      expect(screen.queryByText('Please complete all required fields before signing.')).not.toBeInTheDocument();
    });
  });

  describe('Error handling', () => {
    it('can render without optional callbacks', () => {
      render(<ReviewStep />);

      // Component should still render
      expect(screen.getByText('Review Transaction')).toBeInTheDocument();
    });
  });
});
