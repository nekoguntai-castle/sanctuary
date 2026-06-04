/**
 * Tests for SendTransactionPage component
 */

import { render,screen,waitFor } from '@testing-library/react';
import { MemoryRouter,Route,Routes } from 'react-router-dom';
import { beforeEach,describe,expect,it,vi } from 'vitest';
import { SendTransactionPage } from '../../../components/send/SendTransactionPage';
import * as UserContext from '../../../contexts/UserContext';
import * as bitcoinApi from '../../../src/api/bitcoin';
import * as devicesApi from '../../../src/api/devices';
import * as transactionsApi from '../../../src/api/transactions';
import * as walletsApi from '../../../src/api/wallets';

vi.mock('../../../utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Mock navigate
const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

// Mock contexts
vi.mock('../../../contexts/UserContext', () => ({
  useUser: vi.fn(),
}));

vi.mock('../../../hooks/useErrorHandler', () => ({
  useErrorHandler: () => ({
    showInfo: vi.fn(),
    handleError: vi.fn(),
  }),
}));

// Mock APIs
vi.mock('../../../src/api/wallets', () => ({
  getWallet: vi.fn(),
}));

vi.mock('../../../src/api/transactions', () => ({
  getUTXOs: vi.fn(),
  getAddresses: vi.fn(),
}));

vi.mock('../../../src/api/bitcoin', () => ({
  getFeeEstimates: vi.fn(),
  getMempoolData: vi.fn(),
}));

vi.mock('../../../src/api/devices', () => ({
  getDevices: vi.fn(),
}));

// Mock the wizard component
vi.mock('../../../components/send/SendTransactionWizard', () => {
  type MockSendTransactionWizardProps = {
    wallet?: { name?: string; network?: string };
    utxos?: unknown[];
    initialState?: { currentStep?: string; draftId?: string };
    draftTxData?: { fee?: number };
    calculateFee?: (inputs: number, outputs: number, feeRate: number) => number;
    onCancel?: () => void;
  };

  function MockSendTransactionWizard(props: MockSendTransactionWizardProps) {
    return (
      <div data-testid="send-wizard">
        <span data-testid="wizard-wallet-name">{getWalletName(props)}</span>
        <span data-testid="wizard-wallet-network">{formatOptionalValue(getWalletNetwork(props))}</span>
        <span data-testid="wizard-utxo-count">{getUtxoCount(props)}</span>
        <span data-testid="wizard-initial-step">{formatOptionalValue(getInitialStep(props))}</span>
        <span data-testid="wizard-draft-id">{formatOptionalValue(getDraftId(props))}</span>
        <span data-testid="wizard-draft-fee">{formatOptionalValue(getDraftFee(props))}</span>
        <span data-testid="wizard-calculated-fee">{getCalculatedFee(props)}</span>
        <button data-testid="wizard-cancel" onClick={props.onCancel}>Cancel</button>
      </div>
    );
  }

  function getWalletName(props: MockSendTransactionWizardProps): string | undefined {
    return props.wallet?.name;
  }

  function getWalletNetwork(props: MockSendTransactionWizardProps): string | undefined {
    return props.wallet?.network;
  }

  function getUtxoCount(props: MockSendTransactionWizardProps): number | undefined {
    return props.utxos?.length;
  }

  function getInitialStep(props: MockSendTransactionWizardProps): string | undefined {
    return props.initialState?.currentStep;
  }

  function getDraftId(props: MockSendTransactionWizardProps): string | undefined {
    return props.initialState?.draftId;
  }

  function getDraftFee(props: MockSendTransactionWizardProps): number | undefined {
    return props.draftTxData?.fee;
  }

  function formatOptionalValue(value: number | string | undefined): number | string {
    return value ?? '';
  }

  function getCalculatedFee(props: MockSendTransactionWizardProps): number | string {
    if (!props.calculateFee) return '';

    return props.calculateFee(2, 3, 5);
  }

  return { SendTransactionWizard: MockSendTransactionWizard };
});

describe('SendTransactionPage', () => {
  const mockWallet = {
    id: 'wallet-1',
    name: 'Test Wallet',
    type: 'single_sig:native_segwit',
    balance: 100000,
    scriptType: 'native_segwit',
    network: 'mainnet',
    userRole: 'owner',
  };

  const mockUtxos = {
    utxos: [
      { id: 'utxo-1', txid: 'abc123', vout: 0, address: 'bc1q...', amount: 50000, confirmations: 10, spendable: true },
      { id: 'utxo-2', txid: 'def456', vout: 1, address: 'bc1q...', amount: 30000, confirmations: 100, spendable: true },
    ],
  };

  const mockFees = {
    fastest: 50,
    hour: 25,
    economy: 10,
    minimum: 1,
  };

  const mockMempoolData = {
    mempool: [],
    blocks: [],
    queuedBlocksSummary: null,
  };

  const mockDevices = [
    { id: 'device-1', type: 'ledger', label: 'My Ledger', fingerprint: 'ABC123', wallets: [] },
  ];

  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(UserContext.useUser).mockReturnValue({
      user: { id: 'user-1', username: 'testuser' },
      isLoading: false,
    } as any);

    vi.mocked(walletsApi.getWallet).mockResolvedValue(mockWallet as any);
    vi.mocked(transactionsApi.getUTXOs).mockResolvedValue(mockUtxos as any);
    vi.mocked(transactionsApi.getAddresses).mockResolvedValue([]);
    vi.mocked(bitcoinApi.getFeeEstimates).mockResolvedValue(mockFees as any);
    vi.mocked(bitcoinApi.getMempoolData).mockResolvedValue(mockMempoolData as any);
    vi.mocked(devicesApi.getDevices).mockResolvedValue(mockDevices as any);
  });

  const renderPage = (walletId = 'wallet-1') => {
    return render(
      <MemoryRouter initialEntries={[`/wallets/${walletId}/send`]}>
        <Routes>
          <Route path="/wallets/:id/send" element={<SendTransactionPage />} />
        </Routes>
      </MemoryRouter>
    );
  };

  describe('loading state', () => {
    it('shows loading spinner while fetching data', async () => {
      // Delay the API response
      vi.mocked(walletsApi.getWallet).mockImplementation(
        () => new Promise<never>(() => undefined)
      );

      renderPage();

      // Should show loading indicator
      expect(document.querySelector('.animate-spin')).toBeInTheDocument();
    });

    it('renders wizard after data is loaded', async () => {
      renderPage();

      await waitFor(() => {
        expect(screen.getByTestId('send-wizard')).toBeInTheDocument();
      });
    });
  });

  describe('data fetching', () => {
    it('fetches wallet data', async () => {
      renderPage();

      await waitFor(() => {
        expect(walletsApi.getWallet).toHaveBeenCalledWith('wallet-1');
      });
    });

    it('fetches UTXOs', async () => {
      renderPage();

      await waitFor(() => {
        expect(transactionsApi.getUTXOs).toHaveBeenCalledWith('wallet-1');
      });
    });

    it('fetches fee estimates', async () => {
      renderPage();

      await waitFor(() => {
        expect(bitcoinApi.getFeeEstimates).toHaveBeenCalledWith('mainnet');
      });
    });

    it('fetches mempool data', async () => {
      renderPage();

      await waitFor(() => {
        expect(bitcoinApi.getMempoolData).toHaveBeenCalledWith('mainnet');
      });
    });

    it('uses mainnet fee and mempool defaults when a wallet has no network', async () => {
      vi.mocked(walletsApi.getWallet).mockResolvedValue({
        id: mockWallet.id,
        name: mockWallet.name,
        type: mockWallet.type,
        balance: mockWallet.balance,
        scriptType: mockWallet.scriptType,
        userRole: mockWallet.userRole,
      } as any);

      renderPage();

      await waitFor(() => {
        expect(bitcoinApi.getFeeEstimates).toHaveBeenCalledWith('mainnet');
        expect(bitcoinApi.getMempoolData).toHaveBeenCalledWith('mainnet');
      });
      expect(screen.getByTestId('wizard-wallet-network')).toHaveTextContent('');
    });

    it.each(['testnet3', 'testnet4', 'signet'] as const)(
      'fetches fee estimates and mempool data for %s wallets',
      async (network) => {
        vi.mocked(walletsApi.getWallet).mockResolvedValue({
          ...mockWallet,
          network,
        } as any);

        renderPage();

        await waitFor(() => {
          expect(bitcoinApi.getFeeEstimates).toHaveBeenCalledWith(network);
          expect(bitcoinApi.getMempoolData).toHaveBeenCalledWith(network);
        });
        expect(screen.getByTestId('wizard-wallet-network')).toHaveTextContent(network);
      },
    );

    it('does not fetch mainnet mempool data for regtest wallets', async () => {
      vi.mocked(walletsApi.getWallet).mockResolvedValue({
        ...mockWallet,
        network: 'regtest',
      } as any);

      renderPage();

      await waitFor(() => {
        expect(bitcoinApi.getFeeEstimates).toHaveBeenCalledWith('regtest');
        expect(screen.getByTestId('send-wizard')).toBeInTheDocument();
      });
      expect(bitcoinApi.getMempoolData).not.toHaveBeenCalled();
      expect(screen.getByTestId('wizard-wallet-network')).toHaveTextContent('regtest');
    });

    it('fetches devices', async () => {
      renderPage();

      await waitFor(() => {
        expect(devicesApi.getDevices).toHaveBeenCalled();
      });
    });

    it('passes wallet name to wizard', async () => {
      renderPage();

      await waitFor(() => {
        expect(screen.getByTestId('wizard-wallet-name')).toHaveTextContent('Test Wallet');
      });
    });

    it('passes UTXOs to wizard', async () => {
      renderPage();

      await waitFor(() => {
        expect(screen.getByTestId('wizard-utxo-count')).toHaveTextContent('2');
      });
    });

    it('passes fee calculation callback to wizard', async () => {
      renderPage();

      await waitFor(() => {
        expect(screen.getByTestId('wizard-calculated-fee')).toHaveTextContent('1200');
      });
    });
  });

  describe('error handling', () => {
    it('shows error when wallet fetch fails', async () => {
      vi.mocked(walletsApi.getWallet).mockRejectedValue(new Error('Wallet not found'));

      renderPage();

      await waitFor(() => {
        // Component shows "Failed to Load" heading and "Failed to load transaction data" text
        expect(screen.getByText('Failed to Load')).toBeInTheDocument();
      });
    });

    it('shows go back button on error', async () => {
      vi.mocked(walletsApi.getWallet).mockRejectedValue(new Error('Network error'));

      renderPage();

      await waitFor(() => {
        expect(screen.getByText(/go back/i)).toBeInTheDocument();
      });
    });

    it('navigates back when clicking go back on error', async () => {
      const user = await import('@testing-library/user-event');
      vi.mocked(walletsApi.getWallet).mockRejectedValue(new Error('Network error'));

      renderPage();

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /go back/i })).toBeInTheDocument();
      });

      await user.default.setup().click(screen.getByRole('button', { name: /go back/i }));

      expect(mockNavigate).toHaveBeenCalledWith('/wallets/wallet-1');
    });
  });

  describe('access control', () => {
    it('redirects viewer to wallet page', async () => {
      vi.mocked(walletsApi.getWallet).mockResolvedValue({
        ...mockWallet,
        userRole: 'viewer',
      } as any);

      renderPage();

      await waitFor(() => {
        expect(mockNavigate).toHaveBeenCalledWith('/wallets/wallet-1', { replace: true });
      });
    });

    it('redirects approver to wallet page before loading send data', async () => {
      vi.mocked(walletsApi.getWallet).mockResolvedValue({
        ...mockWallet,
        userRole: 'approver',
      } as any);

      renderPage();

      await waitFor(() => {
        expect(mockNavigate).toHaveBeenCalledWith('/wallets/wallet-1', { replace: true });
      });
      expect(transactionsApi.getUTXOs).not.toHaveBeenCalled();
    });

    it('redirects malformed roles to wallet page', async () => {
      vi.mocked(walletsApi.getWallet).mockResolvedValue({
        ...mockWallet,
        userRole: 'editor',
      } as any);

      renderPage();

      await waitFor(() => {
        expect(mockNavigate).toHaveBeenCalledWith('/wallets/wallet-1', { replace: true });
      });
    });

    it('uses explicit canEdit when the role is missing', async () => {
      vi.mocked(walletsApi.getWallet).mockResolvedValue({
        ...mockWallet,
        canEdit: true,
        userRole: undefined,
      } as any);

      renderPage();

      await waitFor(() => {
        expect(screen.getByTestId('send-wizard')).toBeInTheDocument();
      });
    });

    it('allows owner to access send page', async () => {
      vi.mocked(walletsApi.getWallet).mockResolvedValue({
        ...mockWallet,
        userRole: 'owner',
      } as any);

      renderPage();

      await waitFor(() => {
        expect(screen.getByTestId('send-wizard')).toBeInTheDocument();
      });

      expect(mockNavigate).not.toHaveBeenCalledWith(expect.stringContaining('/wallets/wallet-1'), { replace: true });
    });

    it('allows signer to access send page', async () => {
      vi.mocked(walletsApi.getWallet).mockResolvedValue({
        ...mockWallet,
        userRole: 'signer',
      } as any);

      renderPage();

      await waitFor(() => {
        expect(screen.getByTestId('send-wizard')).toBeInTheDocument();
      });
    });
  });

  describe('cancel action', () => {
    it('navigates back to wallet on cancel', async () => {
      const user = await import('@testing-library/user-event');
      renderPage();

      await waitFor(() => {
        expect(screen.getByTestId('send-wizard')).toBeInTheDocument();
      });

      await user.default.setup().click(screen.getByTestId('wizard-cancel'));

      expect(mockNavigate).toHaveBeenCalledWith(`/wallets/wallet-1`);
    });
  });

  describe('draft loading', () => {
    it('loads draft from location state', async () => {
      const draftData = {
        id: 'draft-1',
        walletId: 'wallet-1',
        userId: 'user-1',
        psbtBase64: 'cHNidP8...',
        feeRate: 25,
        selectedUtxoIds: ['abc123:0'],
        enableRBF: true,
        subtractFees: false,
        sendMax: false,
        isRBF: false,
        status: 'unsigned',
        signedDeviceIds: [],
        recipient: 'bc1qrecipient...',
        amount: 50000,
        fee: 1000,
        totalInput: 100000,
        totalOutput: 99000,
        changeAmount: 49000,
        effectiveAmount: 50000,
        inputPaths: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      render(
        <MemoryRouter initialEntries={[{ pathname: '/wallets/wallet-1/send', state: { draft: draftData } }]}>
          <Routes>
            <Route path="/wallets/:id/send" element={<SendTransactionPage />} />
          </Routes>
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByTestId('send-wizard')).toBeInTheDocument();
      });

      expect(screen.getByTestId('wizard-initial-step')).toHaveTextContent('review');
      expect(screen.getByTestId('wizard-draft-id')).toHaveTextContent('draft-1');
      expect(screen.getByTestId('wizard-draft-fee')).toHaveTextContent('1000');
    });
  });

  describe('pre-selected UTXOs', () => {
    it('loads pre-selected UTXOs from location state', async () => {
      const preSelected = ['abc123:0', 'def456:1'];

      render(
        <MemoryRouter initialEntries={[{ pathname: '/wallets/wallet-1/send', state: { preSelected } }]}>
          <Routes>
            <Route path="/wallets/:id/send" element={<SendTransactionPage />} />
          </Routes>
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByTestId('send-wizard')).toBeInTheDocument();
      });
    });
  });

  describe('multisig wallet', () => {
    it('handles multisig wallet type', async () => {
      vi.mocked(walletsApi.getWallet).mockResolvedValue({
        ...mockWallet,
        type: 'multisig:2/3',
        quorum: { m: 2, n: 3 },
        totalSigners: 3,
      } as any);

      renderPage();

      await waitFor(() => {
        expect(screen.getByTestId('send-wizard')).toBeInTheDocument();
      });
    });

    it('filters devices by fingerprint for multisig', async () => {
      vi.mocked(walletsApi.getWallet).mockResolvedValue({
        ...mockWallet,
        type: 'multisig:2/3',
        descriptor: 'wsh(sortedmulti(2,[abc12345/48h/0h/0h/2h]xpub...,[def67890/48h/0h/0h/2h]xpub...))',
      } as any);

      vi.mocked(devicesApi.getDevices).mockResolvedValue([
        { id: 'device-1', fingerprint: 'abc12345', type: 'ledger', label: 'Ledger 1', wallets: [] },
        { id: 'device-2', fingerprint: 'def67890', type: 'trezor', label: 'Trezor 1', wallets: [] },
        { id: 'device-3', fingerprint: 'nomatch', type: 'coldcard', label: 'Coldcard', wallets: [] },
      ] as any);

      renderPage();

      await waitFor(() => {
        expect(screen.getByTestId('send-wizard')).toBeInTheDocument();
      });
    });
  });

  describe('no user logged in', () => {
    it('does not fetch data when user is not logged in', async () => {
      vi.mocked(UserContext.useUser).mockReturnValue({
        user: null,
        isLoading: false,
      } as any);

      renderPage();

      // Should not make API calls
      await Promise.resolve();
      expect(walletsApi.getWallet).not.toHaveBeenCalled();
    });
  });

  describe('handles API errors gracefully', () => {
    it('continues loading when mempool fetch fails', async () => {
      vi.mocked(bitcoinApi.getMempoolData).mockRejectedValue(new Error('Mempool unavailable'));

      renderPage();

      await waitFor(() => {
        expect(screen.getByTestId('send-wizard')).toBeInTheDocument();
      });
    });

    it('continues loading when addresses fetch fails', async () => {
      vi.mocked(transactionsApi.getAddresses).mockRejectedValue(new Error('Addresses unavailable'));

      renderPage();

      await waitFor(() => {
        expect(screen.getByTestId('send-wizard')).toBeInTheDocument();
      });
    });

    it('continues loading when devices fetch fails', async () => {
      vi.mocked(devicesApi.getDevices).mockRejectedValue(new Error('Devices unavailable'));

      renderPage();

      await waitFor(() => {
        expect(screen.getByTestId('send-wizard')).toBeInTheDocument();
      });
    });
  });
});
