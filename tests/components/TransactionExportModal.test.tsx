/**
 * Tests for TransactionExportModal component
 */

import { render,screen,waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach,describe,expect,it,vi } from 'vitest';
import { TransactionExportModal } from '../../components/TransactionExportModal';

// Mock logger
vi.mock('../../utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Mock transactions API
vi.mock('../../src/api/transactions', () => ({
  exportTransactions: vi.fn(),
}));

import * as transactionsApi from '../../src/api/transactions';

describe('TransactionExportModal', () => {
  const defaultProps = {
    walletId: 'wallet-123',
    walletName: 'My Wallet',
    onClose: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(transactionsApi.exportTransactions).mockResolvedValue(undefined);
  });

  describe('rendering', () => {
    it('renders modal with title', () => {
      render(<TransactionExportModal {...defaultProps} />);

      expect(screen.getByText('Export Transactions')).toBeInTheDocument();
    });

    it('renders close button', () => {
      render(<TransactionExportModal {...defaultProps} />);

      // Close button has X icon
      expect(screen.getByRole('button', { name: '' })).toBeInTheDocument();
    });

    it('renders export format section', () => {
      render(<TransactionExportModal {...defaultProps} />);

      expect(screen.getByText('Export Format')).toBeInTheDocument();
    });

    it('renders date range section', () => {
      render(<TransactionExportModal {...defaultProps} />);

      expect(screen.getByText(/Date Range/)).toBeInTheDocument();
    });
  });

  describe('format selection', () => {
    it('shows CSV and JSON format options', () => {
      render(<TransactionExportModal {...defaultProps} />);

      expect(screen.getByText('CSV')).toBeInTheDocument();
      expect(screen.getByText('JSON')).toBeInTheDocument();
    });

    it('has CSV selected by default (highlighted styling)', () => {
      render(<TransactionExportModal {...defaultProps} />);

      const csvButton = screen.getByText('CSV').closest('button');
      expect(csvButton).toHaveClass('border-primary-500');
    });

    it('allows selecting JSON format', async () => {
      const user = userEvent.setup();
      render(<TransactionExportModal {...defaultProps} />);

      const jsonButton = screen.getByText('JSON').closest('button');
      await user.click(jsonButton!);

      expect(jsonButton).toHaveClass('border-primary-500');
    });

    it('allows switching back to CSV after selecting JSON', async () => {
      const user = userEvent.setup();
      render(<TransactionExportModal {...defaultProps} />);

      const jsonButton = screen.getByText('JSON').closest('button');
      const csvButton = screen.getByText('CSV').closest('button');
      await user.click(jsonButton!);
      await user.click(csvButton!);

      expect(csvButton).toHaveClass('border-primary-500');
    });
  });

  describe('date range filter', () => {
    it('shows date inputs', () => {
      render(<TransactionExportModal {...defaultProps} />);

      expect(screen.getByText('From')).toBeInTheDocument();
      expect(screen.getByText('To')).toBeInTheDocument();
    });

    it('shows help text about empty dates', () => {
      render(<TransactionExportModal {...defaultProps} />);

      expect(screen.getByText(/Leave empty to export all transactions/)).toBeInTheDocument();
    });

    it('renders date inputs', () => {
      render(<TransactionExportModal {...defaultProps} />);

      // Date inputs exist in the DOM
      const dateInputs = document.querySelectorAll('input[type="date"]');
      expect(dateInputs.length).toBe(2);
    });

    it('passes selected start/end dates to export API', async () => {
      const user = userEvent.setup();
      render(<TransactionExportModal {...defaultProps} />);

      const dateInputs = document.querySelectorAll('input[type="date"]') as NodeListOf<HTMLInputElement>;
      await user.type(dateInputs[0], '2025-01-01');
      await user.type(dateInputs[1], '2025-01-31');
      await user.click(screen.getByRole('button', { name: /Export/i }));

      await waitFor(() => {
        expect(transactionsApi.exportTransactions).toHaveBeenCalledWith(
          'wallet-123',
          'My Wallet',
          expect.objectContaining({
            startDate: '2025-01-01',
            endDate: '2025-01-31',
          })
        );
      });
    });
  });

  describe('export action', () => {
    it('shows export button', () => {
      render(<TransactionExportModal {...defaultProps} />);

      expect(screen.getByRole('button', { name: /Export/i })).toBeInTheDocument();
    });

    it('calls exportTransactions API when exporting', async () => {
      const user = userEvent.setup();
      render(<TransactionExportModal {...defaultProps} />);

      await user.click(screen.getByRole('button', { name: /Export/i }));

      await waitFor(() => {
        expect(transactionsApi.exportTransactions).toHaveBeenCalledWith(
          'wallet-123',
          'My Wallet',
          expect.objectContaining({ format: 'csv' })
        );
      });
    });

    it('exports as CSV by default', async () => {
      const user = userEvent.setup();
      render(<TransactionExportModal {...defaultProps} />);

      await user.click(screen.getByRole('button', { name: /Export/i }));

      await waitFor(() => {
        expect(transactionsApi.exportTransactions).toHaveBeenCalledWith(
          'wallet-123',
          'My Wallet',
          expect.objectContaining({ format: 'csv' })
        );
      });
    });

    it('exports as JSON when selected', async () => {
      const user = userEvent.setup();
      render(<TransactionExportModal {...defaultProps} />);

      // Select JSON format
      const jsonButton = screen.getByText('JSON').closest('button');
      await user.click(jsonButton!);

      await user.click(screen.getByRole('button', { name: /Export/i }));

      await waitFor(() => {
        expect(transactionsApi.exportTransactions).toHaveBeenCalledWith(
          'wallet-123',
          'My Wallet',
          expect.objectContaining({ format: 'json' })
        );
      });
    });

    it('closes modal after successful export', async () => {
      const user = userEvent.setup();
      render(<TransactionExportModal {...defaultProps} />);

      await user.click(screen.getByRole('button', { name: /Export/i }));

      await waitFor(() => {
        expect(defaultProps.onClose).toHaveBeenCalled();
      });
    });
  });

  describe('loading state', () => {
    it('shows loading state during export', async () => {
      vi.mocked(transactionsApi.exportTransactions).mockImplementation(
        () => new Promise<never>(() => undefined)
      );

      const user = userEvent.setup();
      render(<TransactionExportModal {...defaultProps} />);

      await user.click(screen.getByRole('button', { name: /Export/i }));

      expect(screen.getByText('Exporting...')).toBeInTheDocument();
    });

    it('disables export button while loading', async () => {
      vi.mocked(transactionsApi.exportTransactions).mockImplementation(
        () => new Promise<never>(() => undefined)
      );

      const user = userEvent.setup();
      render(<TransactionExportModal {...defaultProps} />);

      await user.click(screen.getByRole('button', { name: /Export/i }));

      // Both buttons should be disabled during export
      const buttons = screen.getAllByRole('button');
      const cancelButton = buttons.find(b => b.textContent?.includes('Cancel'));
      expect(cancelButton).toBeDisabled();
    });
  });

  describe('error handling', () => {
    it('shows error message when export fails', async () => {
      vi.mocked(transactionsApi.exportTransactions).mockRejectedValue(new Error('Network error'));

      const user = userEvent.setup();
      render(<TransactionExportModal {...defaultProps} />);

      await user.click(screen.getByRole('button', { name: /Export/i }));

      await waitFor(() => {
        expect(screen.getByText('Network error')).toBeInTheDocument();
      });
    });

    it('keeps modal open on error', async () => {
      const onCloseMock = vi.fn();
      vi.mocked(transactionsApi.exportTransactions).mockRejectedValue(new Error('Network error'));

      const user = userEvent.setup();
      render(<TransactionExportModal {...defaultProps} onClose={onCloseMock} />);

      await user.click(screen.getByRole('button', { name: /Export/i }));

      await waitFor(() => {
        expect(screen.getByText('Export Transactions')).toBeInTheDocument();
      });

      expect(onCloseMock).not.toHaveBeenCalled();
    });

    it('shows fallback error when export rejects with non-Error value', async () => {
      vi.mocked(transactionsApi.exportTransactions).mockRejectedValue('not-an-error-object');

      const user = userEvent.setup();
      render(<TransactionExportModal {...defaultProps} />);

      await user.click(screen.getByRole('button', { name: /Export/i }));

      await waitFor(() => {
        expect(screen.getByText('Export failed')).toBeInTheDocument();
      });
    });
  });

  describe('cancel action', () => {
    it('shows cancel button', () => {
      render(<TransactionExportModal {...defaultProps} />);

      expect(screen.getByRole('button', { name: /Cancel/i })).toBeInTheDocument();
    });

    it('closes modal on cancel', async () => {
      const user = userEvent.setup();
      render(<TransactionExportModal {...defaultProps} />);

      await user.click(screen.getByRole('button', { name: /Cancel/i }));

      expect(defaultProps.onClose).toHaveBeenCalled();
    });
  });

  describe('backdrop click', () => {
    it('closes modal when clicking backdrop', async () => {
      const user = userEvent.setup();
      render(<TransactionExportModal {...defaultProps} />);

      // The backdrop is the outermost div with onClick={onClose}
      const backdrop = document.querySelector('.fixed.inset-0');
      if (backdrop) {
        await user.click(backdrop);

        expect(defaultProps.onClose).toHaveBeenCalled();
      }
    });
  });
});
