/**
 * Tests for OutputsStep component
 */

import { render,screen,waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach,describe,expect,it,vi } from 'vitest';
import { OutputsStep } from '../../../src/components/send/steps/OutputsStep';
import * as CurrencyContext from '../../../src/contexts/CurrencyContext';
import * as SendContext from '../../../src/contexts/send';
import * as TransactionsApi from '../../../src/api/transactions';

// Mock the context
vi.mock('../../../src/contexts/send', () => ({
  useSendTransaction: vi.fn(),
}));

vi.mock('../../../src/contexts/CurrencyContext', () => ({
  useCurrency: vi.fn(),
}));

// Mock child components
vi.mock('../../../src/components/send/OutputRow', () => ({
  OutputRow: ({ index, output, onAddressChange, onAmountChange }: any) => (
    <div data-testid={`output-row-${index}`}>
      <input
        data-testid={`address-input-${index}`}
        value={output.address}
        onChange={(e) => onAddressChange(index, e.target.value)}
      />
      <input
        data-testid={`amount-input-${index}`}
        value={output.amount}
        onChange={(e) => onAmountChange(index, e.target.value, e.target.value)}
      />
    </div>
  ),
}));

vi.mock('../../../src/components/send/FeeSelector', () => ({
  FeeSelector: ({ feeRate, setFeeRate }: any) => (
    <div data-testid="fee-selector">
      <span data-testid="fee-rate">{feeRate}</span>
      <button data-testid="set-fee" onClick={() => setFeeRate(10)}>Set Fee</button>
    </div>
  ),
}));

vi.mock('../../../src/components/send/AdvancedOptions', () => ({
  AdvancedOptions: ({ enableRBF, setEnableRBF }: any) => (
    <div data-testid="advanced-options">
      <input
        type="checkbox"
        data-testid="rbf-checkbox"
        checked={enableRBF}
        onChange={(e) => setEnableRBF(e.target.checked)}
      />
    </div>
  ),
}));

vi.mock('../../../src/components/send/WizardNavigation', () => ({
  WizardNavigation: () => <div data-testid="wizard-navigation">Navigation</div>,
}));

vi.mock('../../../src/components/SpendPrivacyCard', () => ({
  default: () => <div data-testid="spend-privacy-card">Privacy Card</div>,
}));

vi.mock('../../../src/components/PrivacyBadge', () => ({
  PrivacyBadge: () => <span data-testid="privacy-badge">Badge</span>,
}));

// Mock API
vi.mock('../../../src/api/transactions', () => ({
  analyzeSpendPrivacy: vi.fn(),
  getWalletPrivacy: vi.fn(),
}));

describe('OutputsStep', () => {
  const mockDispatch = vi.fn();
  const mockAddOutput = vi.fn();
  const mockRemoveOutput = vi.fn();
  const mockUpdateOutputAddress = vi.fn();
  const mockUpdateOutputAmount = vi.fn();
  const mockToggleSendMax = vi.fn();
  const mockToggleUtxo = vi.fn();
  const mockSelectAllUtxos = vi.fn();
  const mockClearUtxoSelection = vi.fn();
  const mockToggleCoinControl = vi.fn();
  const mockSetFeeRate = vi.fn();

  const mockUtxos = [
    {
      txid: 'abc123',
      vout: 0,
      address: 'bc1q...',
      amount: 100000,
      confirmations: 10,
      frozen: false,
      spent: false,
      spendable: true,
    },
    {
      txid: 'def456',
      vout: 1,
      address: 'bc1q...',
      amount: 50000,
      confirmations: 100,
      frozen: false,
      spent: false,
      spendable: true,
    },
  ];

  const defaultContext = {
    state: {
      transactionType: 'standard' as const,
      outputs: [{ address: '', amount: '', sendMax: false }],
      outputsValid: [null],
      selectedUTXOs: new Set<string>(),
      showCoinControl: false,
      feeRate: 25,
      rbfEnabled: true,
      subtractFees: false,
      useDecoys: false,
      decoyCount: 2,
      scanningOutputIndex: null,
      payjoinUrl: null,
      payjoinStatus: 'idle' as const,
    },
    dispatch: mockDispatch,
    wallet: { id: 'wallet-1', name: 'Test Wallet', network: 'mainnet' },
    utxos: mockUtxos,
    spendableUtxos: mockUtxos,
    addOutput: mockAddOutput,
    removeOutput: mockRemoveOutput,
    updateOutputAddress: mockUpdateOutputAddress,
    updateOutputAmount: mockUpdateOutputAmount,
    toggleSendMax: mockToggleSendMax,
    walletAddresses: [],
    selectedTotal: 150000,
    estimatedFee: 1000,
    totalOutputAmount: 50000,
    toggleUtxo: mockToggleUtxo,
    selectAllUtxos: mockSelectAllUtxos,
    clearUtxoSelection: mockClearUtxoSelection,
    toggleCoinControl: mockToggleCoinControl,
    fees: { fastestFee: 50, halfHourFee: 25, hourFee: 10, economyFee: 5, minimumFee: 1 },
    mempoolBlocks: [],
    queuedBlocksSummary: null,
    setFeeRate: mockSetFeeRate,
  };

  const defaultCurrencyContext = {
    unit: 'sats' as const,
    format: (sats: number) => `${sats} sats`,
    formatFiat: () => '$50.00',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(SendContext.useSendTransaction).mockReturnValue(defaultContext as any);
    vi.mocked(CurrencyContext.useCurrency).mockReturnValue(defaultCurrencyContext as any);
    vi.mocked(TransactionsApi.getWalletPrivacy).mockResolvedValue({
      utxos: [],
      summary: {
        averageScore: 0,
        grade: 'poor',
        utxoCount: 0,
        addressReuseCount: 0,
        roundAmountCount: 0,
        clusterCount: 0,
        recommendations: [],
      },
    });
    vi.mocked(TransactionsApi.analyzeSpendPrivacy).mockResolvedValue({} as any);
  });

  const renderOutputsStep = async () => {
    render(<OutputsStep />);
    await waitFor(() => {
      expect(TransactionsApi.getWalletPrivacy).toHaveBeenCalled();
    });
  };

  describe('Rendering', () => {
    it('renders header for standard transaction', async () => {
      await renderOutputsStep();

      expect(screen.getByText('Compose Transaction')).toBeInTheDocument();
      expect(screen.getByText('Configure your transaction')).toBeInTheDocument();
    });

    it('renders header for consolidation transaction', async () => {
      vi.mocked(SendContext.useSendTransaction).mockReturnValue({
        ...defaultContext,
        state: { ...defaultContext.state, transactionType: 'consolidation' },
      } as any);

      await renderOutputsStep();

      expect(screen.getByText('Consolidation')).toBeInTheDocument();
      expect(screen.getByText('Select UTXOs to consolidate and destination')).toBeInTheDocument();
    });

    it('renders header for sweep transaction', async () => {
      vi.mocked(SendContext.useSendTransaction).mockReturnValue({
        ...defaultContext,
        state: { ...defaultContext.state, transactionType: 'sweep' },
      } as any);

      await renderOutputsStep();

      expect(screen.getByText('Sweep')).toBeInTheDocument();
      expect(screen.getByText('Sweep all funds to a destination')).toBeInTheDocument();
    });

    it('renders summary bar with balances', async () => {
      await renderOutputsStep();

      expect(screen.getByText('Available:')).toBeInTheDocument();
      expect(screen.getByText('Fee:')).toBeInTheDocument();
      expect(screen.getByText('Max:')).toBeInTheDocument();
    });

    it('renders output rows', async () => {
      await renderOutputsStep();

      expect(screen.getByTestId('output-row-0')).toBeInTheDocument();
    });

    it('renders Add Recipient button for standard transaction', async () => {
      await renderOutputsStep();

      expect(screen.getByText('Add Recipient')).toBeInTheDocument();
    });

    it('does not render Add Recipient button for consolidation', async () => {
      vi.mocked(SendContext.useSendTransaction).mockReturnValue({
        ...defaultContext,
        state: { ...defaultContext.state, transactionType: 'consolidation' },
      } as any);

      await renderOutputsStep();

      expect(screen.queryByText('Add Recipient')).not.toBeInTheDocument();
    });

    it('renders collapsible panels', async () => {
      await renderOutputsStep();

      expect(screen.getByText('Coin Control')).toBeInTheDocument();
      expect(screen.getByText('Network Fee')).toBeInTheDocument();
      expect(screen.getByText('Advanced Options')).toBeInTheDocument();
    });

    it('renders wizard navigation', async () => {
      await renderOutputsStep();

      expect(screen.getByTestId('wizard-navigation')).toBeInTheDocument();
    });
  });

  describe('Output management', () => {
    it('calls addOutput when clicking Add Recipient', async () => {
      const user = userEvent.setup();
      await renderOutputsStep();

      await user.click(screen.getByText('Add Recipient'));

      expect(mockAddOutput).toHaveBeenCalled();
    });

    it('displays multiple outputs', async () => {
      vi.mocked(SendContext.useSendTransaction).mockReturnValue({
        ...defaultContext,
        state: {
          ...defaultContext.state,
          outputs: [
            { address: 'bc1q...', amount: '10000', sendMax: false },
            { address: 'bc1p...', amount: '20000', sendMax: false },
          ],
          outputsValid: [true, true],
        },
      } as any);

      await renderOutputsStep();

      expect(screen.getByTestId('output-row-0')).toBeInTheDocument();
      expect(screen.getByTestId('output-row-1')).toBeInTheDocument();
    });
  });

  describe('Coin Control panel', () => {
    it('expands coin control panel when clicked', async () => {
      const user = userEvent.setup();
      await renderOutputsStep();

      await user.click(screen.getByText('Coin Control'));

      expect(screen.getByText('Select All')).toBeInTheDocument();
      expect(screen.getByText('Clear')).toBeInTheDocument();
    });

    it('shows UTXO count badge when UTXOs are selected', async () => {
      vi.mocked(SendContext.useSendTransaction).mockReturnValue({
        ...defaultContext,
        state: {
          ...defaultContext.state,
          showCoinControl: true,
          selectedUTXOs: new Set(['abc123:0', 'def456:1']),
        },
      } as any);

      await renderOutputsStep();

      expect(screen.getByText('2 UTXOs')).toBeInTheDocument();
    });

    it('calls selectAllUtxos when clicking Select All', async () => {
      const user = userEvent.setup();
      await renderOutputsStep();

      await user.click(screen.getByText('Coin Control'));
      await user.click(screen.getByText('Select All'));

      expect(mockSelectAllUtxos).toHaveBeenCalled();
    });

    it('calls clearUtxoSelection when clicking Clear', async () => {
      const user = userEvent.setup();
      await renderOutputsStep();

      await user.click(screen.getByText('Coin Control'));
      await user.click(screen.getByText('Clear'));

      expect(mockClearUtxoSelection).toHaveBeenCalled();
    });

    it('shows remaining needed warning when insufficient UTXOs selected', async () => {
      vi.mocked(SendContext.useSendTransaction).mockReturnValue({
        ...defaultContext,
        state: {
          ...defaultContext.state,
          showCoinControl: true,
          selectedUTXOs: new Set(['abc123:0']),
        },
        selectedTotal: 10000,
        totalOutputAmount: 50000,
        estimatedFee: 1000,
      } as any);

      await renderOutputsStep();

      // Panel is already expanded (showCoinControl: true), so warning should be visible
      expect(screen.getByText(/Need.*more to cover transaction/)).toBeInTheDocument();
    });

    it('shows no spendable UTXOs message when none available', async () => {
      const user = userEvent.setup();
      vi.mocked(SendContext.useSendTransaction).mockReturnValue({
        ...defaultContext,
        utxos: [],
        spendableUtxos: [],
      } as any);

      await renderOutputsStep();

      await user.click(screen.getByText('Coin Control'));

      expect(screen.getByText('No spendable UTXOs')).toBeInTheDocument();
    });

    it('shows frozen UTXOs section when frozen UTXOs exist', async () => {
      const user = userEvent.setup();
      vi.mocked(SendContext.useSendTransaction).mockReturnValue({
        ...defaultContext,
        utxos: [
          ...mockUtxos,
          { txid: 'frozen1', vout: 0, address: 'bc1q...', amount: 30000, frozen: true, spent: false },
        ],
      } as any);

      await renderOutputsStep();

      await user.click(screen.getByText('Coin Control'));

      expect(screen.getByText(/Frozen \(1\)/)).toBeInTheDocument();
    });

    it('shows draft-locked UTXOs section when locked UTXOs exist', async () => {
      const user = userEvent.setup();
      vi.mocked(SendContext.useSendTransaction).mockReturnValue({
        ...defaultContext,
        utxos: [
          ...mockUtxos,
          { txid: 'locked1', vout: 0, address: 'bc1q...', amount: 20000, lockedByDraftId: 'draft-1', spent: false, frozen: false },
        ],
      } as any);

      await renderOutputsStep();

      await user.click(screen.getByText('Coin Control'));

      expect(screen.getByText(/Locked by Drafts \(1\)/)).toBeInTheDocument();
    });
  });

  describe('Fee panel', () => {
    it('expands fee panel when clicked', async () => {
      const user = userEvent.setup();
      await renderOutputsStep();

      await user.click(screen.getByText('Network Fee'));

      expect(screen.getByTestId('fee-selector')).toBeInTheDocument();
    });

    it('shows current fee rate in panel header', async () => {
      await renderOutputsStep();

      // Multiple elements may show the fee rate (panel header and warning)
      const feeRateElements = screen.getAllByText(/25 sat\/vB/);
      expect(feeRateElements.length).toBeGreaterThan(0);
    });
  });

  describe('Advanced Options panel', () => {
    it('expands advanced options panel when clicked', async () => {
      const user = userEvent.setup();
      await renderOutputsStep();

      await user.click(screen.getAllByText('Advanced Options')[0]);

      expect(screen.getByTestId('advanced-options')).toBeInTheDocument();
    });

    it('shows active options in panel header', async () => {
      vi.mocked(SendContext.useSendTransaction).mockReturnValue({
        ...defaultContext,
        state: {
          ...defaultContext.state,
          rbfEnabled: true,
          useDecoys: true,
          subtractFees: true,
        },
      } as any);

      await renderOutputsStep();

      expect(screen.getByText(/RBF, Decoys, Subtract/)).toBeInTheDocument();
    });
  });

  describe('Warnings', () => {
    it('shows no spendable funds warning when wallet is empty', async () => {
      vi.mocked(SendContext.useSendTransaction).mockReturnValue({
        ...defaultContext,
        spendableUtxos: [],
      } as any);

      await renderOutputsStep();

      expect(screen.getByText('No spendable funds available')).toBeInTheDocument();
    });

    it('shows fee warning when fee is excessive', async () => {
      vi.mocked(SendContext.useSendTransaction).mockReturnValue({
        ...defaultContext,
        totalOutputAmount: 10000,
        estimatedFee: 5000, // 50% fee
      } as any);

      await renderOutputsStep();

      expect(screen.getByText(/Fee is.*% of the amount being sent/)).toBeInTheDocument();
    });

    it('shows fee rate warning when much higher than economy', async () => {
      vi.mocked(SendContext.useSendTransaction).mockReturnValue({
        ...defaultContext,
        state: {
          ...defaultContext.state,
          feeRate: 100,
        },
        fees: { fastestFee: 50, halfHourFee: 25, hourFee: 10, economyFee: 5, minimumFee: 1 },
      } as any);

      await renderOutputsStep();

      expect(screen.getByText(/Fee rate.*is.*x the economy rate/)).toBeInTheDocument();
    });
  });

  describe('BIP21 parsing', () => {
    it('parses BIP21 URI and updates address', async () => {
      const user = userEvent.setup();
      await renderOutputsStep();

      const addressInput = screen.getByTestId('address-input-0');
      await user.clear(addressInput);
      await user.type(addressInput, 'bitcoin:bc1qtest?amount=0.001');

      // The component calls updateOutputAddress which is mocked
      expect(mockUpdateOutputAddress).toHaveBeenCalled();
    });
  });

  describe('Privacy analysis', () => {
    it('fetches privacy data for selected UTXOs', async () => {
      vi.mocked(SendContext.useSendTransaction).mockReturnValue({
        ...defaultContext,
        state: {
          ...defaultContext.state,
          showCoinControl: true,
          selectedUTXOs: new Set(['abc123:0']),
        },
      } as any);

      await renderOutputsStep();

      await waitFor(() => {
        expect(TransactionsApi.analyzeSpendPrivacy).toHaveBeenCalled();
      });
    });
  });
});
