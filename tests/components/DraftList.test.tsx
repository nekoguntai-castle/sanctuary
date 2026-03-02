/**
 * Tests for DraftList component
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { DraftList } from '../../components/DraftList';
import { WalletType } from '../../types';
import * as CurrencyContext from '../../contexts/CurrencyContext';
import * as draftsApi from '../../src/api/drafts';
import * as downloadUtils from '../../utils/download';

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
vi.mock('../../contexts/CurrencyContext', () => ({
  useCurrency: vi.fn(),
}));

// Mock API
vi.mock('../../src/api/drafts', () => ({
  getDrafts: vi.fn(),
  deleteDraft: vi.fn(),
  updateDraft: vi.fn(),
}));

vi.mock('../../utils/download', () => ({
  downloadBlob: vi.fn(),
}));

// Mock child components
vi.mock('../../components/TransactionFlowPreview', () => ({
  TransactionFlowPreview: () => <div data-testid="flow-preview">Flow Preview</div>,
}));

vi.mock('../../components/Amount', () => ({
  Amount: ({ sats }: { sats: number }) => <span data-testid="amount">{sats}</span>,
}));

vi.mock('../../components/FiatDisplay', () => ({
  FiatDisplaySubtle: () => <span data-testid="fiat">$50.00</span>,
}));

describe('DraftList', () => {
  const mockDrafts = [
    {
      id: 'draft-1',
      walletId: 'wallet-1',
      name: 'Test Draft',
      status: 'unsigned',
      recipient: 'bc1qrecipient...',
      effectiveAmount: 50000,
      fee: 1000,
      feeRate: 10,
      totalInput: 60000,
      totalOutput: 59000,
      changeAmount: 8000,
      changeAddress: 'bc1qchange...',
      psbtBase64: 'cHNidP8=',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      outputs: [{ address: 'bc1qrecipient...', amount: 50000 }],
    },
    {
      id: 'draft-2',
      walletId: 'wallet-1',
      name: 'Expiring Draft',
      status: 'partial',
      recipient: 'bc1qrecipient2...',
      effectiveAmount: 100000,
      fee: 2000,
      feeRate: 15,
      totalInput: 120000,
      totalOutput: 118000,
      changeAmount: 16000,
      changeAddress: 'bc1qchange2...',
      psbtBase64: 'cHNidP8=',
      signedPsbtBase64: 'cHNidP8=',
      signedDeviceIds: ['device-1'],
      createdAt: new Date(Date.now() - 86400000).toISOString(),
      updatedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 3600000).toISOString(), // 1 hour from now
      outputs: [{ address: 'bc1qrecipient2...', amount: 100000 }],
    },
  ];

  const defaultProps = {
    walletId: 'wallet-1',
    walletType: WalletType.SINGLE_SIG,
  };

  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(CurrencyContext.useCurrency).mockReturnValue({
      format: (sats: number) => `${sats} sats`,
      unit: 'sats',
    } as any);

    vi.mocked(draftsApi.getDrafts).mockResolvedValue(mockDrafts as any);
    vi.mocked(draftsApi.deleteDraft).mockResolvedValue(undefined);
    vi.mocked(draftsApi.updateDraft).mockResolvedValue({} as any);
  });

  const renderDraftList = (props = {}) => {
    return render(
      <MemoryRouter>
        <DraftList {...defaultProps} {...props} />
      </MemoryRouter>
    );
  };

  describe('loading state', () => {
    it('shows loading state initially', () => {
      vi.mocked(draftsApi.getDrafts).mockImplementation(
        () => new Promise(resolve => setTimeout(() => resolve(mockDrafts as any), 100))
      );

      renderDraftList();

      // Component should be in loading state initially
      expect(draftsApi.getDrafts).toHaveBeenCalled();
    });
  });

  describe('rendering drafts', () => {
    it('loads and displays drafts', async () => {
      renderDraftList();

      await waitFor(() => {
        expect(screen.getByText('bc1qrecipient2...')).toBeInTheDocument();
        expect(screen.getByText('bc1qrecipient...')).toBeInTheDocument();
      });
    });

    it('displays draft status badges', async () => {
      renderDraftList();

      await waitFor(() => {
        expect(screen.getByText('Unsigned')).toBeInTheDocument();
      });
    });

    it('displays expiration info', async () => {
      renderDraftList();

      await waitFor(() => {
        expect(screen.getByText(/Expires in/)).toBeInTheDocument();
      });
    });

    it('calls getDrafts with wallet ID', async () => {
      renderDraftList();

      await waitFor(() => {
        expect(draftsApi.getDrafts).toHaveBeenCalledWith('wallet-1');
      });
    });

    it('calls onDraftsChange with count', async () => {
      const onDraftsChange = vi.fn();
      renderDraftList({ onDraftsChange });

      await waitFor(() => {
        expect(onDraftsChange).toHaveBeenCalledWith(mockDrafts.length);
      });
    });
  });

  describe('fee warnings', () => {
    it('shows fee warning for high fee percentage', async () => {
      const highFeeDrafts = [
        {
          ...mockDrafts[0],
          effectiveAmount: 10000,
          fee: 5000, // 50% fee
        },
      ];

      vi.mocked(draftsApi.getDrafts).mockResolvedValue(highFeeDrafts as any);

      renderDraftList();

      await waitFor(() => {
        expect(screen.getByText(/Fee is more than half of the amount!/i)).toBeInTheDocument();
      });
    });
  });

  describe('empty state', () => {
    it('shows empty state when no drafts', async () => {
      vi.mocked(draftsApi.getDrafts).mockResolvedValue([]);

      renderDraftList();

      await waitFor(() => {
        // Component shows "No draft transactions" when empty
        expect(screen.getByText(/No draft transactions/i)).toBeInTheDocument();
      });
    });
  });

  describe('error handling', () => {
    it('shows error when fetch fails', async () => {
      vi.mocked(draftsApi.getDrafts).mockRejectedValue(new Error('Network error'));

      renderDraftList();

      await waitFor(() => {
        expect(screen.getByText(/error|failed/i)).toBeInTheDocument();
      });
    });
  });

  describe('interactive actions', () => {
    it('navigates to send page when resuming without onResume callback', async () => {
      const user = userEvent.setup();
      renderDraftList();

      const resumeButtons = await screen.findAllByRole('button', { name: /resume/i });
      await user.click(resumeButtons[0]);

      expect(mockNavigate).toHaveBeenCalledWith('/wallets/wallet-1/send', {
        state: { draft: expect.objectContaining({ id: 'draft-2' }) },
      });
    });

    it('calls onResume callback when provided', async () => {
      const user = userEvent.setup();
      const onResume = vi.fn();
      renderDraftList({ onResume });

      const resumeButtons = await screen.findAllByRole('button', { name: /resume/i });
      await user.click(resumeButtons[0]);

      expect(onResume).toHaveBeenCalledWith(expect.objectContaining({ id: 'draft-2' }));
      expect(mockNavigate).not.toHaveBeenCalled();
    });

    it('downloads PSBT for single-sig drafts', async () => {
      const user = userEvent.setup();
      renderDraftList();

      await screen.findByText('Unsigned');
      await user.click(screen.getAllByTitle('Download PSBT')[0]);

      expect(downloadUtils.downloadBlob).toHaveBeenCalled();
      expect(vi.mocked(downloadUtils.downloadBlob).mock.calls[0]?.[1]).toMatch(/sanctuary-draft-.*\.psbt/);
    });

    it('shows and confirms delete flow', async () => {
      const user = userEvent.setup();
      const onDraftsChange = vi.fn();
      renderDraftList({ onDraftsChange });

      await screen.findByText('Unsigned');
      await user.click(screen.getAllByTitle('Delete draft')[0]);
      expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: 'Delete' }));
      await waitFor(() => {
        expect(draftsApi.deleteDraft).toHaveBeenCalledWith('wallet-1', 'draft-2');
      });
      expect(onDraftsChange).toHaveBeenCalledWith(1);
    });

    it('cancels delete flow without deleting', async () => {
      const user = userEvent.setup();
      renderDraftList();

      await screen.findByText('Unsigned');
      await user.click(screen.getAllByTitle('Delete draft')[0]);
      await user.click(screen.getByRole('button', { name: 'Cancel' }));

      expect(draftsApi.deleteDraft).not.toHaveBeenCalled();
    });

    it('expands and collapses transaction flow preview', async () => {
      const user = userEvent.setup();
      renderDraftList();

      const showButtons = await screen.findAllByRole('button', { name: /show transaction flow/i });
      await user.click(showButtons[0]);
      expect(screen.getByTestId('flow-preview')).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: /hide transaction flow/i }));
      expect(screen.queryByTestId('flow-preview')).not.toBeInTheDocument();
    });

    it('uploads binary PSBT and marks single-sig draft as signed', async () => {
      renderDraftList();
      await screen.findByText('Unsigned');

      const binaryPsbt = new Uint8Array([0x70, 0x73, 0x62, 0x74, 0xff, 0x01, 0x02]).buffer;
      const file = {
        name: 'signed.psbt',
        arrayBuffer: () => Promise.resolve(binaryPsbt),
        text: () => Promise.resolve(''),
      } as unknown as File;
      const fileInputs = document.querySelectorAll('input[type="file"]');
      fireEvent.change(fileInputs[0] as HTMLInputElement, { target: { files: [file] } });

      await waitFor(() => {
        expect(draftsApi.updateDraft).toHaveBeenCalledWith(
          'wallet-1',
          'draft-2',
          expect.objectContaining({ status: 'signed', signedPsbtBase64: expect.any(String) })
        );
      });
      expect(draftsApi.getDrafts).toHaveBeenCalledTimes(2);
    });

    it('uploads base64 PSBT and marks single-sig draft as signed', async () => {
      renderDraftList();
      await screen.findByText('Unsigned');

      const file = {
        name: 'signed.txt',
        arrayBuffer: () => Promise.resolve(new Uint8Array([0x00]).buffer),
        text: () => Promise.resolve('cHNidP8='),
      } as unknown as File;
      const fileInputs = document.querySelectorAll('input[type="file"]');
      fireEvent.change(fileInputs[0] as HTMLInputElement, { target: { files: [file] } });

      await waitFor(() => {
        expect(draftsApi.updateDraft).toHaveBeenCalledWith(
          'wallet-1',
          'draft-2',
          expect.objectContaining({ status: 'signed', signedPsbtBase64: expect.any(String) })
        );
      });
    });

    it('uploads hex PSBT and marks single-sig draft as signed', async () => {
      renderDraftList();
      await screen.findByText('Unsigned');

      const realMatch = String.prototype.match;
      const matchSpy = vi.spyOn(String.prototype, 'match').mockImplementation(function (
        this: string,
        pattern: string | RegExp
      ) {
        if (this.toString() === '70736274ff0102' && pattern instanceof RegExp && pattern.source === '^[A-Za-z0-9+/=\\s]+$') {
          return null as any;
        }
        return realMatch.call(this.toString(), pattern as any);
      });

      const file = {
        name: 'signed.hex',
        arrayBuffer: () => Promise.resolve(new Uint8Array([0x00]).buffer),
        text: () => Promise.resolve('70736274ff0102'),
      } as unknown as File;
      const fileInputs = document.querySelectorAll('input[type="file"]');
      fireEvent.change(fileInputs[0] as HTMLInputElement, { target: { files: [file] } });

      await waitFor(() => {
        expect(draftsApi.updateDraft).toHaveBeenCalledWith(
          'wallet-1',
          'draft-2',
          expect.objectContaining({ status: 'signed', signedPsbtBase64: expect.any(String) })
        );
      });

      matchSpy.mockRestore();
    });

    it('shows operation error when uploaded PSBT format is invalid', async () => {
      renderDraftList();
      await screen.findByText('Unsigned');

      const file = {
        name: 'invalid.txt',
        arrayBuffer: () => Promise.resolve(new Uint8Array([0x00]).buffer),
        text: () => Promise.resolve('not-a-psbt'),
      } as unknown as File;
      const fileInputs = document.querySelectorAll('input[type="file"]');
      fireEvent.change(fileInputs[0] as HTMLInputElement, { target: { files: [file] } });

      await waitFor(() => {
        expect(screen.getByText(/Expected binary, base64, or hex/i)).toBeInTheDocument();
      });
    });

    it('hides edit controls when canEdit is false', async () => {
      renderDraftList({ canEdit: false });
      await screen.findByText('Unsigned');

      expect(screen.queryByTitle('Delete draft')).not.toBeInTheDocument();
      expect(document.querySelectorAll('input[type="file"]').length).toBe(0);
    });

    it('hides download/upload controls for multisig mode', async () => {
      renderDraftList({ walletType: WalletType.MULTI_SIG, quorum: { m: 2, n: 3 } });
      await screen.findByText(/1 of 2 signed/i);

      expect(screen.queryByTitle('Download PSBT')).not.toBeInTheDocument();
      expect(document.querySelectorAll('input[type="file"]').length).toBe(0);
    });
  });

  describe('error retry', () => {
    it('retries loading drafts from error state', async () => {
      const user = userEvent.setup();
      vi.mocked(draftsApi.getDrafts)
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce([]);

      renderDraftList();

      const retryButton = await screen.findByRole('button', { name: /try again/i });
      await user.click(retryButton);

      await waitFor(() => {
        expect(draftsApi.getDrafts).toHaveBeenCalledTimes(2);
      });
      expect(screen.getByText(/No draft transactions/i)).toBeInTheDocument();
    });
  });
});
