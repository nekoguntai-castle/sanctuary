/**
 * Tests for SendTransactionPage component
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { SendTransactionPage } from '../../../components/send/SendTransactionPage';
import * as UserContext from '../../../contexts/UserContext';
import * as walletsApi from '../../../src/api/wallets';
import * as transactionsApi from '../../../src/api/transactions';
import * as bitcoinApi from '../../../src/api/bitcoin';
import * as devicesApi from '../../../src/api/devices';

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
vi.mock('../../../components/send/SendTransactionWizard', () => ({
  SendTransactionWizard: (props: any) => (
    <div data-testid="send-wizard">
      <span data-testid="wizard-wallet-name">{props.wallet?.name}</span>
      <span data-testid="wizard-utxo-count">{props.utxos?.length}</span>
      <span data-testid="wizard-initial-step">{props.initialState?.currentStep ?? ''}</span>
      <span data-testid="wizard-draft-id">{props.initialState?.draftId ?? ''}</span>
      <span data-testid="wizard-draft-fee">{props.draftTxData?.fee ?? ''}</span>
      <span data-testid="wizard-calculated-fee">{props.calculateFee ? props.calculateFee(2, 3, 5) : ''}</span>
      <button data-testid="wizard-cancel" onClick={props.onCancel}>Cancel</button>
    </div>
  ),
}));

describe('SendTransactionPage', () => {
  const mockWallet = {
    id: 'wallet-1',
    name: 'Test Wallet',
    type: 'single_sig:native_segwit',
    balance: 100000,
    scriptType: 'native_segwit',
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
        () => new Promise(resolve => setTimeout(() => resolve(mockWallet as any), 100))
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
        expect(bitcoinApi.getFeeEstimates).toHaveBeenCalled();
      });
    });

    it('fetches mempool data', async () => {
      renderPage();

      await waitFor(() => {
        expect(bitcoinApi.getMempoolData).toHaveBeenCalled();
      });
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
      await new Promise(resolve => setTimeout(resolve, 50));
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
