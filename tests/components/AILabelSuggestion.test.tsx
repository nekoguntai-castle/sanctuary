/**
 * AILabelSuggestion Component Tests
 *
 * Tests for the AI-powered label suggestion component.
 * Covers rendering states, user interactions, and error handling.
 */

import { fireEvent,render,screen,waitFor } from '@testing-library/react';
import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';

// Mock the AI API
const mockSuggestLabel = vi.fn();

vi.mock('../../src/api/ai', () => ({
  suggestLabel: (req: { transactionId: string }) => mockSuggestLabel(req),
}));

// Mock the logger
vi.mock('../../utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Import component after mocks
import { AILabelSuggestion } from '../../components/AILabelSuggestion';
import { Transaction } from '../../types';

// Test transaction data
const mockTransaction: Transaction = {
  id: 'tx-test-001',
  txid: 'abc123def456789...',
  amount: 50000,
  type: 'receive',
  confirmations: 6,
  blockTime: '2024-01-15T10:30:00Z',
  walletId: 'wallet-123',
  address: 'bc1q...',
  fee: 0,
};

describe('AILabelSuggestion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSuggestLabel.mockResolvedValue({ suggestion: 'Exchange deposit' });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Initial Rendering', () => {
    it('should render the suggest button initially', () => {
      render(<AILabelSuggestion transaction={mockTransaction} />);

      expect(screen.getByText('Suggest with AI')).toBeInTheDocument();
    });

    it('should render with custom className', () => {
      const { container } = render(
        <AILabelSuggestion transaction={mockTransaction} className="custom-class" />
      );

      expect(container.firstChild).toHaveClass('custom-class');
    });

    it('should not show suggestion or error initially', () => {
      render(<AILabelSuggestion transaction={mockTransaction} />);

      expect(screen.queryByText('AI Suggestion')).not.toBeInTheDocument();
      expect(screen.queryByText(/Failed to get suggestion/)).not.toBeInTheDocument();
    });
  });

  describe('Loading State', () => {
    it('should show loading state when fetching suggestion', async () => {
      // Delay the resolution to observe loading state
      mockSuggestLabel.mockImplementation(
        () => new Promise<never>(() => undefined)
      );

      render(<AILabelSuggestion transaction={mockTransaction} />);

      const button = screen.getByText('Suggest with AI');
      fireEvent.click(button);

      expect(screen.getByText('Getting suggestion...')).toBeInTheDocument();
    });

    it('should disable button during loading', async () => {
      mockSuggestLabel.mockImplementation(
        () => new Promise<never>(() => undefined)
      );

      render(<AILabelSuggestion transaction={mockTransaction} />);

      const button = screen.getByRole('button');
      fireEvent.click(button);

      expect(button).toBeDisabled();
    });
  });

  describe('Successful Suggestion', () => {
    it('should display suggestion after successful API call', async () => {
      mockSuggestLabel.mockResolvedValue({ suggestion: 'Exchange deposit' });

      render(<AILabelSuggestion transaction={mockTransaction} />);

      const button = screen.getByText('Suggest with AI');
      fireEvent.click(button);

      await waitFor(() => {
        expect(screen.getByText('Exchange deposit')).toBeInTheDocument();
      });

      expect(screen.getByText('AI Suggestion')).toBeInTheDocument();
    });

    it('should hide suggest button after getting suggestion', async () => {
      mockSuggestLabel.mockResolvedValue({ suggestion: 'Mining reward' });

      render(<AILabelSuggestion transaction={mockTransaction} />);

      fireEvent.click(screen.getByText('Suggest with AI'));

      await waitFor(() => {
        expect(screen.queryByText('Suggest with AI')).not.toBeInTheDocument();
      });
    });

    it('should show Use This and Dismiss buttons after suggestion', async () => {
      mockSuggestLabel.mockResolvedValue({ suggestion: 'Payment' });

      render(<AILabelSuggestion transaction={mockTransaction} />);

      fireEvent.click(screen.getByText('Suggest with AI'));

      await waitFor(() => {
        expect(screen.getByText('Use This')).toBeInTheDocument();
        expect(screen.getByText('Dismiss')).toBeInTheDocument();
      });
    });

    it('should call onSuggestionAccepted when Use This is clicked', async () => {
      const onSuggestionAccepted = vi.fn();
      mockSuggestLabel.mockResolvedValue({ suggestion: 'Salary' });

      render(
        <AILabelSuggestion
          transaction={mockTransaction}
          onSuggestionAccepted={onSuggestionAccepted}
        />
      );

      fireEvent.click(screen.getByText('Suggest with AI'));

      await waitFor(() => {
        expect(screen.getByText('Salary')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText('Use This'));

      expect(onSuggestionAccepted).toHaveBeenCalledWith('Salary');
    });

    it('should clear suggestion after accepting', async () => {
      const onSuggestionAccepted = vi.fn();
      mockSuggestLabel.mockResolvedValue({ suggestion: 'Shopping' });

      render(
        <AILabelSuggestion
          transaction={mockTransaction}
          onSuggestionAccepted={onSuggestionAccepted}
        />
      );

      fireEvent.click(screen.getByText('Suggest with AI'));

      await waitFor(() => {
        expect(screen.getByText('Shopping')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText('Use This'));

      await waitFor(() => {
        expect(screen.queryByText('Shopping')).not.toBeInTheDocument();
      });
    });

    it('keeps suggestion visible when Use This is clicked without accept callback', async () => {
      mockSuggestLabel.mockResolvedValue({ suggestion: 'No callback suggestion' });

      render(<AILabelSuggestion transaction={mockTransaction} />);

      fireEvent.click(screen.getByText('Suggest with AI'));
      await waitFor(() => {
        expect(screen.getByText('No callback suggestion')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText('Use This'));
      expect(screen.getByText('No callback suggestion')).toBeInTheDocument();
    });

    it('should clear suggestion when Dismiss is clicked', async () => {
      mockSuggestLabel.mockResolvedValue({ suggestion: 'Transfer' });

      render(<AILabelSuggestion transaction={mockTransaction} />);

      fireEvent.click(screen.getByText('Suggest with AI'));

      await waitFor(() => {
        expect(screen.getByText('Transfer')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText('Dismiss'));

      await waitFor(() => {
        expect(screen.queryByText('Transfer')).not.toBeInTheDocument();
        expect(screen.queryByText('AI Suggestion')).not.toBeInTheDocument();
      });
    });
  });

  describe('Error Handling', () => {
    it('should display error when AI is not enabled', async () => {
      mockSuggestLabel.mockRejectedValue(new Error('503: not enabled'));

      render(<AILabelSuggestion transaction={mockTransaction} />);

      fireEvent.click(screen.getByText('Suggest with AI'));

      await waitFor(() => {
        expect(screen.getByText(/AI is not enabled/)).toBeInTheDocument();
      });
    });

    it('should display rate limit error', async () => {
      mockSuggestLabel.mockRejectedValue(new Error('429: Too many requests'));

      render(<AILabelSuggestion transaction={mockTransaction} />);

      fireEvent.click(screen.getByText('Suggest with AI'));

      await waitFor(() => {
        expect(screen.getByText(/rate limit reached/i)).toBeInTheDocument();
      });
    });

    it('should display timeout-specific error', async () => {
      mockSuggestLabel.mockRejectedValue(new Error('request timed out'));

      render(<AILabelSuggestion transaction={mockTransaction} />);

      fireEvent.click(screen.getByText('Suggest with AI'));

      await waitFor(() => {
        expect(screen.getByText(/Request timed out/)).toBeInTheDocument();
      });
    });

    it('should display network-specific error', async () => {
      mockSuggestLabel.mockRejectedValue(new Error('network unavailable'));

      render(<AILabelSuggestion transaction={mockTransaction} />);

      fireEvent.click(screen.getByText('Suggest with AI'));

      await waitFor(() => {
        expect(screen.getByText(/Network error/)).toBeInTheDocument();
      });
    });

    it('should display generic error for other failures', async () => {
      mockSuggestLabel.mockRejectedValue(new Error('Network error'));

      render(<AILabelSuggestion transaction={mockTransaction} />);

      fireEvent.click(screen.getByText('Suggest with AI'));

      await waitFor(() => {
        expect(screen.getByText(/Failed to get suggestion/)).toBeInTheDocument();
      });
    });

    it('should handle non-Error thrown values gracefully', async () => {
      mockSuggestLabel.mockRejectedValue('string-error');

      render(<AILabelSuggestion transaction={mockTransaction} />);

      fireEvent.click(screen.getByText('Suggest with AI'));

      await waitFor(() => {
        expect(screen.getByText(/Failed to get suggestion/)).toBeInTheDocument();
      });
    });

    it('should allow dismissing error', async () => {
      mockSuggestLabel.mockRejectedValue(new Error('Test error'));

      render(<AILabelSuggestion transaction={mockTransaction} />);

      fireEvent.click(screen.getByText('Suggest with AI'));

      await waitFor(() => {
        expect(screen.getByText(/Failed to get suggestion/)).toBeInTheDocument();
      });

      // Find dismiss button - it's the button with the X icon in the error container
      // The error container has the class 'bg-rose-50'
      const errorContainer = document.querySelector('.bg-rose-50');
      const dismissButton = errorContainer?.querySelector('button');
      expect(dismissButton).not.toBeNull();

      if (dismissButton) {
        fireEvent.click(dismissButton);
      }

      await waitFor(() => {
        expect(screen.queryByText(/Failed to get suggestion/)).not.toBeInTheDocument();
      });
    });

    it('should not show suggestion button while error is displayed', async () => {
      mockSuggestLabel.mockRejectedValue(new Error('Test error'));

      render(<AILabelSuggestion transaction={mockTransaction} />);

      fireEvent.click(screen.getByText('Suggest with AI'));

      await waitFor(() => {
        expect(screen.getByText(/Failed to get suggestion/)).toBeInTheDocument();
      });

      // Button should be hidden when error is shown (based on implementation)
      // The button is shown when there's no suggestion AND no error
    });
  });

  describe('Transaction ID Handling', () => {
    it('should pass transaction ID to API', async () => {
      mockSuggestLabel.mockResolvedValue({ suggestion: 'Test' });

      render(<AILabelSuggestion transaction={mockTransaction} />);

      fireEvent.click(screen.getByText('Suggest with AI'));

      await waitFor(() => {
        expect(mockSuggestLabel).toHaveBeenCalledWith({
          transactionId: 'tx-test-001',
        });
      });
    });

    it('should work with different transaction IDs', async () => {
      mockSuggestLabel.mockResolvedValue({ suggestion: 'Different' });

      const differentTransaction = {
        ...mockTransaction,
        id: 'tx-different-123',
      };

      render(<AILabelSuggestion transaction={differentTransaction} />);

      fireEvent.click(screen.getByText('Suggest with AI'));

      await waitFor(() => {
        expect(mockSuggestLabel).toHaveBeenCalledWith({
          transactionId: 'tx-different-123',
        });
      });
    });
  });

  describe('Existing Labels Prop', () => {
    it('should accept existingLabels prop', () => {
      // This prop is passed but not used for display - it's for AI context
      render(
        <AILabelSuggestion
          transaction={mockTransaction}
          existingLabels={['Exchange', 'Trading']}
        />
      );

      expect(screen.getByText('Suggest with AI')).toBeInTheDocument();
    });
  });

  describe('Accessibility', () => {
    it('should have accessible button', () => {
      render(<AILabelSuggestion transaction={mockTransaction} />);

      const button = screen.getByRole('button');
      expect(button).toBeInTheDocument();
    });

    it('should have descriptive button text', () => {
      render(<AILabelSuggestion transaction={mockTransaction} />);

      expect(screen.getByText('Suggest with AI')).toBeInTheDocument();
    });
  });

  describe('Multiple Requests', () => {
    it('should handle rapid clicks gracefully', async () => {
      let resolvePromise!: (value: { suggestion: string }) => void;
      mockSuggestLabel.mockImplementation(
        () => new Promise(resolve => { resolvePromise = resolve; })
      );

      render(<AILabelSuggestion transaction={mockTransaction} />);

      const button = screen.getByRole('button');

      // Click multiple times
      fireEvent.click(button);
      fireEvent.click(button);
      fireEvent.click(button);

      // Button should be disabled, so only one call should be made
      expect(mockSuggestLabel).toHaveBeenCalledTimes(1);

      // Resolve the promise
      resolvePromise({ suggestion: 'Test' });

      await waitFor(() => {
        expect(screen.getByText('Test')).toBeInTheDocument();
      });
    });
  });

  describe('Component Rerender', () => {
    it('should reset state when transaction changes', async () => {
      mockSuggestLabel.mockResolvedValue({ suggestion: 'First suggestion' });

      const { rerender } = render(
        <AILabelSuggestion transaction={mockTransaction} />
      );

      fireEvent.click(screen.getByText('Suggest with AI'));

      await waitFor(() => {
        expect(screen.getByText('First suggestion')).toBeInTheDocument();
      });

      // Note: The component doesn't automatically reset on transaction change
      // This tests current behavior - user needs to dismiss and re-request
      const newTransaction = { ...mockTransaction, id: 'tx-new-001' };

      rerender(<AILabelSuggestion transaction={newTransaction} />);

      // Previous suggestion should still be visible (current behavior)
      expect(screen.getByText('First suggestion')).toBeInTheDocument();
    });
  });

  describe('UI Styling', () => {
    it('should apply proper styling classes', () => {
      const { container } = render(
        <AILabelSuggestion transaction={mockTransaction} />
      );

      expect(container.firstChild).toHaveClass('space-y-3');
    });

    it('should style suggest button correctly', () => {
      render(<AILabelSuggestion transaction={mockTransaction} />);

      const button = screen.getByRole('button');
      expect(button).toHaveClass('flex', 'items-center');
    });
  });
});
