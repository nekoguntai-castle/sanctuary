/**
 * Tests for TransactionActions component
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { TransactionActions } from '../../components/TransactionActions';
import * as bitcoinApi from '../../src/api/bitcoin';
import * as draftsApi from '../../src/api/drafts';
import * as transactionsApi from '../../src/api/transactions';

// Mock logger
vi.mock('../../utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
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

// Mock APIs
vi.mock('../../src/api/bitcoin', () => ({
  checkRBF: vi.fn(),
  createRBFTransaction: vi.fn(),
  createCPFPTransaction: vi.fn(),
}));

vi.mock('../../src/api/drafts', () => ({
  createDraft: vi.fn(),
}));

vi.mock('../../src/api/transactions', () => ({
  getTransaction: vi.fn(),
}));

describe('TransactionActions', () => {
  const defaultProps = {
    txid: 'abc123def456',
    walletId: 'wallet-1',
    confirmed: false,
    isReceived: false,
    onActionComplete: vi.fn(),
  };

  const mockRbfStatus = {
    replaceable: true,
    currentFeeRate: 10,
    minNewFeeRate: 15,
    reason: null,
  };

  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(bitcoinApi.checkRBF).mockResolvedValue(mockRbfStatus as any);
    vi.mocked(transactionsApi.getTransaction).mockResolvedValue({
      txid: 'abc123def456',
      label: 'Test Transaction',
    } as any);
    vi.mocked(bitcoinApi.createRBFTransaction).mockResolvedValue({
      psbtBase64: 'cHNidP8...',
      feeRate: 20,
      fee: 2000,
      inputs: [{ txid: 'prev123', vout: 0, value: 50000 }],
      outputs: [
        { address: 'bc1qrecipient...', value: 47000 },
        { address: 'bc1qchange...', value: 1000 },
      ],
    } as any);
    vi.mocked(draftsApi.createDraft).mockResolvedValue({
      id: 'draft-1',
      psbtBase64: 'cHNidP8...',
    } as any);
    vi.mocked(bitcoinApi.createCPFPTransaction).mockResolvedValue({
      psbtBase64: 'cHNidP8...',
      effectiveFeeRate: 25,
    } as any);
  });

  const renderComponent = (props = {}) => {
    return render(
      <MemoryRouter>
        <TransactionActions {...defaultProps} {...props} />
      </MemoryRouter>
    );
  };

  describe('loading state', () => {
    it('shows loading spinner while checking RBF status', async () => {
      vi.mocked(bitcoinApi.checkRBF).mockImplementation(
        () => new Promise(resolve => setTimeout(() => resolve(mockRbfStatus as any), 100))
      );

      renderComponent();

      expect(document.querySelector('.animate-spin')).toBeInTheDocument();
    });

    it('handles RBF status check failures and still leaves loading state', async () => {
      vi.mocked(bitcoinApi.checkRBF).mockRejectedValueOnce('status unavailable' as any);

      renderComponent();

      await waitFor(() => {
        expect(screen.getByText('Transaction Actions')).toBeInTheDocument();
      });
      expect(screen.queryByText(/Bump Fee \(RBF\)/)).not.toBeInTheDocument();
    });
  });

  describe('confirmed transactions', () => {
    it('returns null for confirmed transactions', async () => {
      const { container } = renderComponent({ confirmed: true });

      await waitFor(() => {
        expect(container.firstChild).toBeNull();
      });
    });

    it('does not check RBF status for confirmed transactions', async () => {
      renderComponent({ confirmed: true });

      await waitFor(() => {
        expect(bitcoinApi.checkRBF).not.toHaveBeenCalled();
      });
    });
  });

  describe('RBF (Replace-By-Fee)', () => {
    it('shows RBF button for replaceable sent transactions', async () => {
      renderComponent();

      await waitFor(() => {
        expect(screen.getByText(/Bump Fee \(RBF\)/)).toBeInTheDocument();
      });
    });

    it('shows current fee rate', async () => {
      renderComponent();

      await waitFor(() => {
        expect(screen.getByText(/10 sat\/vB/)).toBeInTheDocument();
      });
    });

    it('does not show RBF for received transactions', async () => {
      renderComponent({ isReceived: true });

      await waitFor(() => {
        expect(screen.queryByText(/Bump Fee \(RBF\)/)).not.toBeInTheDocument();
      });
    });

    it('does not show RBF when transaction is not replaceable', async () => {
      vi.mocked(bitcoinApi.checkRBF).mockResolvedValue({
        replaceable: false,
        reason: 'Transaction not signaled RBF',
      } as any);

      renderComponent();

      await waitFor(() => {
        expect(screen.queryByText(/Bump Fee \(RBF\)/)).not.toBeInTheDocument();
        expect(screen.getByText(/Transaction not signaled RBF/)).toBeInTheDocument();
      });
    });

    it('opens RBF modal when clicking button', async () => {
      const user = userEvent.setup();
      renderComponent();

      await waitFor(() => {
        expect(screen.getByText(/Bump Fee \(RBF\)/)).toBeInTheDocument();
      });

      await user.click(screen.getByText(/Bump Fee \(RBF\)/));

      await waitFor(() => {
        expect(screen.getByText('Bump Transaction Fee (RBF)')).toBeInTheDocument();
        expect(screen.getByText(/Replace-By-Fee/)).toBeInTheDocument();
      });
    });

    it('shows minimum fee rate in modal', async () => {
      const user = userEvent.setup();
      renderComponent();

      await waitFor(() => {
        expect(screen.getByText(/Bump Fee \(RBF\)/)).toBeInTheDocument();
      });

      await user.click(screen.getByText(/Bump Fee \(RBF\)/));

      await waitFor(() => {
        expect(screen.getByText(/Minimum: 15 sat\/vB/)).toBeInTheDocument();
      });
    });

    it('creates RBF transaction and navigates to send page', async () => {
      const user = userEvent.setup();
      renderComponent();

      await waitFor(() => {
        expect(screen.getByText(/Bump Fee \(RBF\)/)).toBeInTheDocument();
      });

      await user.click(screen.getByText(/Bump Fee \(RBF\)/));

      // Enter new fee rate
      const input = screen.getByRole('spinbutton');
      await user.clear(input);
      await user.type(input, '20');

      // Click bump fee button
      const bumpButton = screen.getAllByText(/Bump Fee/i).find(btn =>
        btn.closest('button')?.textContent?.includes('Bump Fee') &&
        !btn.closest('button')?.textContent?.includes('(RBF)')
      );
      if (bumpButton) {
        await user.click(bumpButton);
      }

      await waitFor(() => {
        expect(bitcoinApi.createRBFTransaction).toHaveBeenCalledWith('abc123def456', {
          newFeeRate: 20,
          walletId: 'wallet-1',
        });
      });

      await waitFor(() => {
        expect(mockNavigate).toHaveBeenCalledWith(
          '/wallets/wallet-1/send',
          expect.objectContaining({ state: { draft: expect.any(Object) } })
        );
      });
    });

    it('shows error when RBF fails', async () => {
      vi.mocked(bitcoinApi.createRBFTransaction).mockRejectedValue(new Error('Insufficient funds'));

      const user = userEvent.setup();
      renderComponent();

      await waitFor(() => {
        expect(screen.getByText(/Bump Fee \(RBF\)/)).toBeInTheDocument();
      });

      await user.click(screen.getByText(/Bump Fee \(RBF\)/));

      const input = screen.getByRole('spinbutton');
      await user.clear(input);
      await user.type(input, '20');

      const bumpButton = screen.getAllByText(/Bump Fee/i).find(btn =>
        btn.closest('button')?.textContent?.includes('Bump Fee') &&
        !btn.closest('button')?.textContent?.includes('(RBF)')
      );
      if (bumpButton) {
        await user.click(bumpButton);
      }

      await waitFor(() => {
        expect(screen.getByText(/Insufficient funds/)).toBeInTheDocument();
      });
    });

    it('uses fallback draft label and supports missing onActionComplete callback', async () => {
      vi.mocked(transactionsApi.getTransaction).mockResolvedValueOnce({
        txid: 'abc123def456',
        label: '',
      } as any);

      const user = userEvent.setup();
      renderComponent({ onActionComplete: undefined });

      await waitFor(() => {
        expect(screen.getByText(/Bump Fee \(RBF\)/)).toBeInTheDocument();
      });

      await user.click(screen.getByText(/Bump Fee \(RBF\)/));
      const input = screen.getByRole('spinbutton');
      await user.clear(input);
      await user.type(input, '20');

      const bumpButton = screen.getAllByText(/Bump Fee/i).find(btn =>
        btn.closest('button')?.textContent?.includes('Bump Fee') &&
        !btn.closest('button')?.textContent?.includes('(RBF)')
      );
      if (bumpButton) {
        await user.click(bumpButton);
      }

      await waitFor(() => {
        expect(draftsApi.createDraft).toHaveBeenCalledWith(
          'wallet-1',
          expect.objectContaining({
            label: 'RBF: Fee bump from 10 to 20 sat/vB',
          })
        );
      });
    });

    it('shows fallback RBF error message when thrown error has no message', async () => {
      vi.mocked(bitcoinApi.createRBFTransaction).mockRejectedValueOnce({} as any);

      const user = userEvent.setup();
      renderComponent();

      await waitFor(() => {
        expect(screen.getByText(/Bump Fee \(RBF\)/)).toBeInTheDocument();
      });

      await user.click(screen.getByText(/Bump Fee \(RBF\)/));
      const input = screen.getByRole('spinbutton');
      await user.clear(input);
      await user.type(input, '20');

      const bumpButton = screen.getAllByText(/Bump Fee/i).find(btn =>
        btn.closest('button')?.textContent?.includes('Bump Fee') &&
        !btn.closest('button')?.textContent?.includes('(RBF)')
      );
      if (bumpButton) {
        await user.click(bumpButton);
      }

      await waitFor(() => {
        expect(screen.getByText(/Failed to create RBF transaction/)).toBeInTheDocument();
      });
    });

    it('uses default minimum fee fallback when minNewFeeRate is absent', async () => {
      vi.mocked(bitcoinApi.checkRBF).mockResolvedValueOnce({
        replaceable: true,
        currentFeeRate: 12,
        reason: null,
      } as any);

      const user = userEvent.setup();
      renderComponent();

      await waitFor(() => {
        expect(screen.getByText(/Bump Fee \(RBF\)/)).toBeInTheDocument();
      });

      await user.click(screen.getByText(/Bump Fee \(RBF\)/));

      const input = screen.getByRole('spinbutton');
      expect(input).toHaveAttribute('min', '0.1');
      expect(screen.queryByText(/Minimum:/)).not.toBeInTheDocument();

      const modalButtons = screen.getAllByRole('button', { name: /Bump Fee/i });
      const submitButton = modalButtons.find(
        btn => !btn.textContent?.includes('(RBF)')
      ) as HTMLButtonElement | undefined;
      expect(submitButton?.disabled).toBe(true);
    });

    it('no-ops RBF when fee rate is zero even if button click is forced', async () => {
      vi.mocked(bitcoinApi.checkRBF).mockResolvedValueOnce({
        replaceable: true,
        currentFeeRate: 10,
        minNewFeeRate: -1,
        reason: null,
      } as any);

      const user = userEvent.setup();
      renderComponent();

      await waitFor(() => {
        expect(screen.getByText(/Bump Fee \(RBF\)/)).toBeInTheDocument();
      });

      await user.click(screen.getByText(/Bump Fee \(RBF\)/));
      const input = screen.getByRole('spinbutton');
      await user.clear(input);
      await user.type(input, '0');

      const modalButtons = screen.getAllByRole('button', { name: /Bump Fee/i });
      const submitButton = modalButtons.find(
        btn => !btn.textContent?.includes('(RBF)')
      ) as HTMLButtonElement | undefined;
      if (submitButton) {
        await user.click(submitButton);
      }

      expect(bitcoinApi.createRBFTransaction).not.toHaveBeenCalled();
    });

    it('closes modal on cancel', async () => {
      const user = userEvent.setup();
      renderComponent();

      await waitFor(() => {
        expect(screen.getByText(/Bump Fee \(RBF\)/)).toBeInTheDocument();
      });

      await user.click(screen.getByText(/Bump Fee \(RBF\)/));

      await waitFor(() => {
        expect(screen.getByText('Bump Transaction Fee (RBF)')).toBeInTheDocument();
      });

      await user.click(screen.getByText('Cancel'));

      await waitFor(() => {
        expect(screen.queryByText('Bump Transaction Fee (RBF)')).not.toBeInTheDocument();
      });
    });
  });

  describe('CPFP (Child-Pays-For-Parent)', () => {
    it('shows CPFP button for received transactions', async () => {
      renderComponent({ isReceived: true });

      await waitFor(() => {
        expect(screen.getByText(/Accelerate \(CPFP\)/)).toBeInTheDocument();
      });
    });

    it('does not show CPFP for sent transactions', async () => {
      renderComponent({ isReceived: false });

      await waitFor(() => {
        expect(screen.queryByText(/Accelerate \(CPFP\)/)).not.toBeInTheDocument();
      });
    });

    it('opens CPFP modal when clicking button', async () => {
      const user = userEvent.setup();
      renderComponent({ isReceived: true });

      await waitFor(() => {
        expect(screen.getByText(/Accelerate \(CPFP\)/)).toBeInTheDocument();
      });

      await user.click(screen.getByText(/Accelerate \(CPFP\)/));

      await waitFor(() => {
        expect(screen.getByText('Accelerate Transaction (CPFP)')).toBeInTheDocument();
        expect(screen.getByText(/Child-Pays-For-Parent/)).toBeInTheDocument();
      });
    });

    it('creates CPFP transaction', async () => {
      const user = userEvent.setup();
      renderComponent({ isReceived: true });

      await waitFor(() => {
        expect(screen.getByText(/Accelerate \(CPFP\)/)).toBeInTheDocument();
      });

      await user.click(screen.getByText(/Accelerate \(CPFP\)/));

      const input = screen.getByRole('spinbutton');
      await user.clear(input);
      await user.type(input, '50');

      // Find the Accelerate button in the modal
      const accelerateButton = screen.getAllByText('Accelerate').find(btn =>
        btn.closest('button')
      );
      if (accelerateButton) {
        await user.click(accelerateButton);
      }

      await waitFor(() => {
        expect(bitcoinApi.createCPFPTransaction).toHaveBeenCalledWith({
          parentTxid: 'abc123def456',
          parentVout: 0,
          targetFeeRate: 50,
          recipientAddress: '',
          walletId: 'wallet-1',
        });
      });
    });

    it('shows success message after CPFP', async () => {
      const user = userEvent.setup();
      renderComponent({ isReceived: true });

      await waitFor(() => {
        expect(screen.getByText(/Accelerate \(CPFP\)/)).toBeInTheDocument();
      });

      await user.click(screen.getByText(/Accelerate \(CPFP\)/));

      const input = screen.getByRole('spinbutton');
      await user.clear(input);
      await user.type(input, '50');

      const accelerateButton = screen.getAllByText('Accelerate').find(btn =>
        btn.closest('button')
      );
      if (accelerateButton) {
        await user.click(accelerateButton);
      }

      await waitFor(() => {
        expect(screen.getByText(/CPFP transaction created/)).toBeInTheDocument();
        expect(screen.getByText(/25.*sat\/vB/)).toBeInTheDocument();
      });
    });

    it('shows error when CPFP fails', async () => {
      vi.mocked(bitcoinApi.createCPFPTransaction).mockRejectedValue(new Error('No spendable output'));

      const user = userEvent.setup();
      renderComponent({ isReceived: true });

      await waitFor(() => {
        expect(screen.getByText(/Accelerate \(CPFP\)/)).toBeInTheDocument();
      });

      await user.click(screen.getByText(/Accelerate \(CPFP\)/));

      const input = screen.getByRole('spinbutton');
      await user.clear(input);
      await user.type(input, '50');

      const accelerateButton = screen.getAllByText('Accelerate').find(btn =>
        btn.closest('button')
      );
      if (accelerateButton) {
        await user.click(accelerateButton);
      }

      await waitFor(() => {
        expect(screen.getByText(/No spendable output/)).toBeInTheDocument();
      });
    });

    it('supports successful CPFP flow when onActionComplete is not provided', async () => {
      const user = userEvent.setup();
      renderComponent({ isReceived: true, onActionComplete: undefined });

      await waitFor(() => {
        expect(screen.getByText(/Accelerate \(CPFP\)/)).toBeInTheDocument();
      });

      await user.click(screen.getByText(/Accelerate \(CPFP\)/));
      const input = screen.getByRole('spinbutton');
      await user.clear(input);
      await user.type(input, '50');

      const accelerateButton = screen.getAllByText('Accelerate').find(btn =>
        btn.closest('button')
      );
      if (accelerateButton) {
        await user.click(accelerateButton);
      }

      await waitFor(() => {
        expect(screen.getByText(/CPFP transaction created/)).toBeInTheDocument();
      });
    });

    it('shows fallback CPFP error message when thrown error has no message', async () => {
      vi.mocked(bitcoinApi.createCPFPTransaction).mockRejectedValueOnce({} as any);

      const user = userEvent.setup();
      renderComponent({ isReceived: true });

      await waitFor(() => {
        expect(screen.getByText(/Accelerate \(CPFP\)/)).toBeInTheDocument();
      });

      await user.click(screen.getByText(/Accelerate \(CPFP\)/));
      const input = screen.getByRole('spinbutton');
      await user.clear(input);
      await user.type(input, '50');

      const accelerateButton = screen.getAllByText('Accelerate').find(btn =>
        btn.closest('button')
      );
      if (accelerateButton) {
        await user.click(accelerateButton);
      }

      await waitFor(() => {
        expect(screen.getByText(/Failed to create CPFP transaction/)).toBeInTheDocument();
      });
    });

    it('no-ops CPFP when target fee is zero even if disabled button is forced', async () => {
      const user = userEvent.setup();
      renderComponent({ isReceived: true });

      await waitFor(() => {
        expect(screen.getByText(/Accelerate \(CPFP\)/)).toBeInTheDocument();
      });

      await user.click(screen.getByText(/Accelerate \(CPFP\)/));
      const modalButtons = screen.getAllByRole('button', { name: 'Accelerate' });
      const submitButton = modalButtons[modalButtons.length - 1] as HTMLButtonElement;
      submitButton.disabled = false;
      fireEvent.click(submitButton);

      expect(bitcoinApi.createCPFPTransaction).not.toHaveBeenCalled();
    });

    it('closes CPFP modal on cancel', async () => {
      const user = userEvent.setup();
      renderComponent({ isReceived: true });

      await waitFor(() => {
        expect(screen.getByText(/Accelerate \(CPFP\)/)).toBeInTheDocument();
      });

      await user.click(screen.getByText(/Accelerate \(CPFP\)/));

      await waitFor(() => {
        expect(screen.getByText('Accelerate Transaction (CPFP)')).toBeInTheDocument();
      });

      await user.click(screen.getByText('Cancel'));

      await waitFor(() => {
        expect(screen.queryByText('Accelerate Transaction (CPFP)')).not.toBeInTheDocument();
      });
    });
  });

  describe('action callback', () => {
    it('calls onActionComplete after successful RBF', async () => {
      const onActionComplete = vi.fn();
      const user = userEvent.setup();
      renderComponent({ onActionComplete });

      await waitFor(() => {
        expect(screen.getByText(/Bump Fee \(RBF\)/)).toBeInTheDocument();
      });

      await user.click(screen.getByText(/Bump Fee \(RBF\)/));

      const input = screen.getByRole('spinbutton');
      await user.clear(input);
      await user.type(input, '20');

      const bumpButton = screen.getAllByText(/Bump Fee/i).find(btn =>
        btn.closest('button')?.textContent?.includes('Bump Fee') &&
        !btn.closest('button')?.textContent?.includes('(RBF)')
      );
      if (bumpButton) {
        await user.click(bumpButton);
      }

      await waitFor(() => {
        expect(onActionComplete).toHaveBeenCalled();
      });
    });
  });
});
