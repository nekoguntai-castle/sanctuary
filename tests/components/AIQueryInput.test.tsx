/**
 * AIQueryInput Component Tests
 *
 * Tests for the AI natural language query input component.
 * Covers rendering, user interactions, query execution, and error handling.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

// Mock the AI API
const mockExecuteNaturalQuery = vi.fn();

vi.mock('../../src/api/ai', () => ({
  executeNaturalQuery: (req: { query: string; walletId: string }) => mockExecuteNaturalQuery(req),
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
import { AIQueryInput, default as AIQueryInputDefault } from '../../components/AIQueryInput';

// Test data
const testWalletId = 'wallet-test-001';

const mockQueryResult = {
  type: 'transactions' as const,
  filter: { type: 'receive' },
  sort: { field: 'amount', order: 'desc' as const },
  limit: 10,
};

describe('AIQueryInput', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExecuteNaturalQuery.mockResolvedValue(mockQueryResult);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Initial Rendering', () => {
    it('should render the search input', () => {
      render(<AIQueryInput walletId={testWalletId} />);

      expect(screen.getByPlaceholderText('Ask about your transactions...')).toBeInTheDocument();
    });

    it('should render with custom className', () => {
      const { container } = render(
        <AIQueryInput walletId={testWalletId} className="custom-class" />
      );

      expect(container.firstChild).toHaveClass('custom-class');
    });

    it('should have a submit button', () => {
      render(<AIQueryInput walletId={testWalletId} />);

      const buttons = screen.getAllByRole('button');
      expect(buttons.length).toBeGreaterThan(0);
    });

    it('should not show results initially', () => {
      render(<AIQueryInput walletId={testWalletId} />);

      expect(screen.queryByText('AI interpreted your query as:')).not.toBeInTheDocument();
    });

    it('should not show error initially', () => {
      render(<AIQueryInput walletId={testWalletId} />);

      expect(screen.queryByText(/Failed to process query/)).not.toBeInTheDocument();
    });
  });

  describe('Example Queries', () => {
    it('should show example queries when input is focused and empty', async () => {
      render(<AIQueryInput walletId={testWalletId} />);

      const input = screen.getByPlaceholderText('Ask about your transactions...');
      fireEvent.focus(input);

      await waitFor(() => {
        expect(screen.getByText('Try asking...')).toBeInTheDocument();
      });
    });

    it('should display predefined example queries', async () => {
      render(<AIQueryInput walletId={testWalletId} />);

      const input = screen.getByPlaceholderText('Ask about your transactions...');
      fireEvent.focus(input);

      await waitFor(() => {
        expect(screen.getByText('Show my largest receives')).toBeInTheDocument();
      });
    });

    it('should fill input when example is clicked', async () => {
      render(<AIQueryInput walletId={testWalletId} />);

      const input = screen.getByPlaceholderText('Ask about your transactions...') as HTMLInputElement;
      fireEvent.focus(input);

      await waitFor(() => {
        expect(screen.getByText('Show my largest receives')).toBeInTheDocument();
      });

      const exampleButton = screen.getByText('Show my largest receives');
      fireEvent.click(exampleButton);

      expect(input.value).toBe('Show my largest receives');
    });

    it('should hide examples when input has text', async () => {
      render(<AIQueryInput walletId={testWalletId} />);

      const input = screen.getByPlaceholderText('Ask about your transactions...');
      fireEvent.focus(input);

      await waitFor(() => {
        expect(screen.getByText('Try asking...')).toBeInTheDocument();
      });

      await userEvent.type(input, 'test query');

      await waitFor(() => {
        expect(screen.queryByText('Try asking...')).not.toBeInTheDocument();
      });
    });

    it('should hide examples shortly after input blur', async () => {
      const originalSetTimeout = globalThis.setTimeout;
      const timeoutCallbacks: Array<() => void> = [];
      const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout').mockImplementation(
        ((callback: TimerHandler, delay?: number, ...args: unknown[]) => {
          if (delay === 200 && typeof callback === 'function') {
            timeoutCallbacks.push(() => callback(...args));
            return 0 as unknown as ReturnType<typeof setTimeout>;
          }

          return originalSetTimeout(callback, delay, ...args);
        }) as typeof setTimeout
      );

      render(<AIQueryInput walletId={testWalletId} />);

      const input = screen.getByPlaceholderText('Ask about your transactions...');
      fireEvent.focus(input);

      await waitFor(() => {
        expect(screen.getByText('Try asking...')).toBeInTheDocument();
      });

      fireEvent.blur(input);
      expect(setTimeoutSpy).toHaveBeenCalled();
      expect(timeoutCallbacks).toHaveLength(1);

      act(() => {
        timeoutCallbacks[0]();
      });

      await waitFor(() => {
        expect(screen.queryByText('Try asking...')).not.toBeInTheDocument();
      });
    });
  });

  describe('Query Submission', () => {
    it('should submit query on form submit', async () => {
      render(<AIQueryInput walletId={testWalletId} />);

      const input = screen.getByPlaceholderText('Ask about your transactions...');
      await userEvent.type(input, 'Show my transactions');

      const form = input.closest('form');
      fireEvent.submit(form!);

      await waitFor(() => {
        expect(mockExecuteNaturalQuery).toHaveBeenCalledWith({
          query: 'Show my transactions',
          walletId: testWalletId,
        });
      });
    });

    it('should not submit empty query', async () => {
      render(<AIQueryInput walletId={testWalletId} />);

      const form = screen.getByPlaceholderText('Ask about your transactions...').closest('form');
      fireEvent.submit(form!);

      expect(mockExecuteNaturalQuery).not.toHaveBeenCalled();
    });

    it('should not submit whitespace-only query', async () => {
      render(<AIQueryInput walletId={testWalletId} />);

      const input = screen.getByPlaceholderText('Ask about your transactions...');
      await userEvent.type(input, '   ');

      const form = input.closest('form');
      fireEvent.submit(form!);

      expect(mockExecuteNaturalQuery).not.toHaveBeenCalled();
    });

    it('should trim query before submission', async () => {
      render(<AIQueryInput walletId={testWalletId} />);

      const input = screen.getByPlaceholderText('Ask about your transactions...');
      await userEvent.type(input, '  Show transactions  ');

      const form = input.closest('form');
      fireEvent.submit(form!);

      await waitFor(() => {
        expect(mockExecuteNaturalQuery).toHaveBeenCalledWith({
          query: 'Show transactions',
          walletId: testWalletId,
        });
      });
    });

    it('should pass walletId to API', async () => {
      const customWalletId = 'custom-wallet-123';
      render(<AIQueryInput walletId={customWalletId} />);

      const input = screen.getByPlaceholderText('Ask about your transactions...');
      await userEvent.type(input, 'Test query');

      const form = input.closest('form');
      fireEvent.submit(form!);

      await waitFor(() => {
        expect(mockExecuteNaturalQuery).toHaveBeenCalledWith({
          query: 'Test query',
          walletId: customWalletId,
        });
      });
    });
  });

  describe('Loading State', () => {
    it('should show loading state during query execution', async () => {
      mockExecuteNaturalQuery.mockImplementation(
        () => new Promise(resolve => setTimeout(() => resolve(mockQueryResult), 100))
      );

      render(<AIQueryInput walletId={testWalletId} />);

      const input = screen.getByPlaceholderText('Ask about your transactions...');
      await userEvent.type(input, 'Test query');

      const form = input.closest('form');
      fireEvent.submit(form!);

      // The submit button should show loading spinner
      await waitFor(() => {
        expect(input).toBeDisabled();
      });
    });

    it('should disable input during loading', async () => {
      mockExecuteNaturalQuery.mockImplementation(
        () => new Promise(resolve => setTimeout(() => resolve(mockQueryResult), 100))
      );

      render(<AIQueryInput walletId={testWalletId} />);

      const input = screen.getByPlaceholderText('Ask about your transactions...') as HTMLInputElement;
      await userEvent.type(input, 'Test query');

      const form = input.closest('form');
      fireEvent.submit(form!);

      await waitFor(() => {
        expect(input.disabled).toBe(true);
      });
    });
  });

  describe('Result Display', () => {
    it('should display result after successful query', async () => {
      render(<AIQueryInput walletId={testWalletId} />);

      const input = screen.getByPlaceholderText('Ask about your transactions...');
      await userEvent.type(input, 'Show largest receives');

      const form = input.closest('form');
      fireEvent.submit(form!);

      await waitFor(() => {
        expect(screen.getByText('AI interpreted your query as:')).toBeInTheDocument();
      });
    });

    it('should display query type in result', async () => {
      render(<AIQueryInput walletId={testWalletId} />);

      const input = screen.getByPlaceholderText('Ask about your transactions...');
      await userEvent.type(input, 'Show transactions');

      const form = input.closest('form');
      fireEvent.submit(form!);

      await waitFor(() => {
        expect(screen.getByText(/Type: transactions/)).toBeInTheDocument();
      });
    });

    it('should display filter in result when present', async () => {
      mockExecuteNaturalQuery.mockResolvedValue({
        type: 'transactions',
        filter: { label: 'Exchange' },
      });

      render(<AIQueryInput walletId={testWalletId} />);

      const input = screen.getByPlaceholderText('Ask about your transactions...');
      await userEvent.type(input, 'Find exchange transactions');

      const form = input.closest('form');
      fireEvent.submit(form!);

      await waitFor(() => {
        expect(screen.getByText(/Filter:/)).toBeInTheDocument();
      });
    });

    it('should display sort in result when present', async () => {
      mockExecuteNaturalQuery.mockResolvedValue({
        type: 'transactions',
        sort: { field: 'amount', order: 'desc' },
      });

      render(<AIQueryInput walletId={testWalletId} />);

      const input = screen.getByPlaceholderText('Ask about your transactions...');
      await userEvent.type(input, 'Show sorted transactions');

      const form = input.closest('form');
      fireEvent.submit(form!);

      await waitFor(() => {
        expect(screen.getByText(/Sort: amount \(desc\)/)).toBeInTheDocument();
      });
    });

    it('should display limit in result when present', async () => {
      mockExecuteNaturalQuery.mockResolvedValue({
        type: 'transactions',
        limit: 10,
      });

      render(<AIQueryInput walletId={testWalletId} />);

      const input = screen.getByPlaceholderText('Ask about your transactions...');
      await userEvent.type(input, 'Show 10 transactions');

      const form = input.closest('form');
      fireEvent.submit(form!);

      await waitFor(() => {
        expect(screen.getByText(/Limit: 10/)).toBeInTheDocument();
      });
    });

    it('should display aggregation in result when present', async () => {
      mockExecuteNaturalQuery.mockResolvedValue({
        type: 'summary',
        aggregation: 'sum',
      });

      render(<AIQueryInput walletId={testWalletId} />);

      const input = screen.getByPlaceholderText('Ask about your transactions...');
      await userEvent.type(input, 'Total amount');

      const form = input.closest('form');
      fireEvent.submit(form!);

      await waitFor(() => {
        expect(screen.getByText(/Aggregation: sum/)).toBeInTheDocument();
      });
    });

    it('should call onQueryResult callback with result', async () => {
      const onQueryResult = vi.fn();
      render(<AIQueryInput walletId={testWalletId} onQueryResult={onQueryResult} />);

      const input = screen.getByPlaceholderText('Ask about your transactions...');
      await userEvent.type(input, 'Test query');

      const form = input.closest('form');
      fireEvent.submit(form!);

      await waitFor(() => {
        expect(onQueryResult).toHaveBeenCalledWith(mockQueryResult);
      });
    });
  });

  describe('Error Handling', () => {
    it('should display error when AI is not enabled', async () => {
      mockExecuteNaturalQuery.mockRejectedValue(new Error('503: not enabled'));

      render(<AIQueryInput walletId={testWalletId} />);

      const input = screen.getByPlaceholderText('Ask about your transactions...');
      await userEvent.type(input, 'Test query');

      const form = input.closest('form');
      fireEvent.submit(form!);

      await waitFor(() => {
        expect(screen.getByText(/AI is not enabled/)).toBeInTheDocument();
      });
    });

    it('should display rate limit error', async () => {
      mockExecuteNaturalQuery.mockRejectedValue(new Error('429: Too many requests'));

      render(<AIQueryInput walletId={testWalletId} />);

      const input = screen.getByPlaceholderText('Ask about your transactions...');
      await userEvent.type(input, 'Test query');

      const form = input.closest('form');
      fireEvent.submit(form!);

      await waitFor(() => {
        expect(screen.getByText(/Too many requests/)).toBeInTheDocument();
      });
    });

    it('should display generic error for other failures', async () => {
      mockExecuteNaturalQuery.mockRejectedValue(new Error('Network error'));

      render(<AIQueryInput walletId={testWalletId} />);

      const input = screen.getByPlaceholderText('Ask about your transactions...');
      await userEvent.type(input, 'Test query');

      const form = input.closest('form');
      fireEvent.submit(form!);

      await waitFor(() => {
        expect(screen.getByText(/Failed to process query/)).toBeInTheDocument();
      });
    });

    it('should allow dismissing error', async () => {
      mockExecuteNaturalQuery.mockRejectedValue(new Error('Test error'));

      render(<AIQueryInput walletId={testWalletId} />);

      const input = screen.getByPlaceholderText('Ask about your transactions...');
      await userEvent.type(input, 'Test query');

      const form = input.closest('form');
      fireEvent.submit(form!);

      await waitFor(() => {
        expect(screen.getByText(/Failed to process query/)).toBeInTheDocument();
      });

      // Find dismiss button
      const errorContainer = screen.getByText(/Failed to process query/).closest('div');
      const buttons = errorContainer?.querySelectorAll('button');
      const dismissButton = buttons?.[buttons.length - 1];

      if (dismissButton) {
        fireEvent.click(dismissButton);
      }

      await waitFor(() => {
        expect(screen.queryByText(/Failed to process query/)).not.toBeInTheDocument();
      });
    });
  });

  describe('Clear Query', () => {
    it('should show clear button when query has text', async () => {
      render(<AIQueryInput walletId={testWalletId} />);

      const input = screen.getByPlaceholderText('Ask about your transactions...');
      await userEvent.type(input, 'Test query');

      // Look for the X button
      const buttons = screen.getAllByRole('button');
      expect(buttons.length).toBeGreaterThan(1); // Clear + Submit buttons
    });

    it('should clear input when clear button is clicked', async () => {
      render(<AIQueryInput walletId={testWalletId} />);

      const input = screen.getByPlaceholderText('Ask about your transactions...') as HTMLInputElement;
      await userEvent.type(input, 'Test query');

      expect(input.value).toBe('Test query');

      // Find and click clear button (first button that's not submit)
      const buttons = screen.getAllByRole('button');
      const clearButton = buttons.find(btn => btn.getAttribute('type') === 'button');

      if (clearButton) {
        fireEvent.click(clearButton);
      }

      await waitFor(() => {
        expect(input.value).toBe('');
      });
    });

    it('should clear result when input is cleared', async () => {
      render(<AIQueryInput walletId={testWalletId} />);

      const input = screen.getByPlaceholderText('Ask about your transactions...');
      await userEvent.type(input, 'Test query');

      const form = input.closest('form');
      fireEvent.submit(form!);

      await waitFor(() => {
        expect(screen.getByText('AI interpreted your query as:')).toBeInTheDocument();
      });

      // Clear the input
      const buttons = screen.getAllByRole('button');
      const clearButton = buttons.find(btn => btn.getAttribute('type') === 'button');

      if (clearButton) {
        fireEvent.click(clearButton);
      }

      await waitFor(() => {
        expect(screen.queryByText('AI interpreted your query as:')).not.toBeInTheDocument();
      });
    });

    it('should clear error when input is cleared', async () => {
      mockExecuteNaturalQuery.mockRejectedValue(new Error('Test error'));

      render(<AIQueryInput walletId={testWalletId} />);

      const input = screen.getByPlaceholderText('Ask about your transactions...');
      await userEvent.type(input, 'Test query');

      const form = input.closest('form');
      fireEvent.submit(form!);

      await waitFor(() => {
        expect(screen.getByText(/Failed to process query/)).toBeInTheDocument();
      });

      // Clear the input
      const buttons = screen.getAllByRole('button');
      const clearButton = buttons.find(btn => btn.getAttribute('type') === 'button');

      if (clearButton) {
        fireEvent.click(clearButton);
      }

      await waitFor(() => {
        expect(screen.queryByText(/Failed to process query/)).not.toBeInTheDocument();
      });
    });
  });

  describe('Query Types', () => {
    it('should handle transactions query type', async () => {
      mockExecuteNaturalQuery.mockResolvedValue({
        type: 'transactions',
        filter: {},
      });

      render(<AIQueryInput walletId={testWalletId} />);

      const input = screen.getByPlaceholderText('Ask about your transactions...');
      await userEvent.type(input, 'Show transactions');

      const form = input.closest('form');
      fireEvent.submit(form!);

      await waitFor(() => {
        expect(screen.getByText(/Type: transactions/)).toBeInTheDocument();
      });
    });

    it('should handle addresses query type', async () => {
      mockExecuteNaturalQuery.mockResolvedValue({
        type: 'addresses',
        filter: { used: false },
      });

      render(<AIQueryInput walletId={testWalletId} />);

      const input = screen.getByPlaceholderText('Ask about your transactions...');
      await userEvent.type(input, 'Show unused addresses');

      const form = input.closest('form');
      fireEvent.submit(form!);

      await waitFor(() => {
        expect(screen.getByText(/Type: addresses/)).toBeInTheDocument();
      });
    });

    it('should handle utxos query type', async () => {
      mockExecuteNaturalQuery.mockResolvedValue({
        type: 'utxos',
        filter: { spent: false },
      });

      render(<AIQueryInput walletId={testWalletId} />);

      const input = screen.getByPlaceholderText('Ask about your transactions...');
      await userEvent.type(input, 'Show available UTXOs');

      const form = input.closest('form');
      fireEvent.submit(form!);

      await waitFor(() => {
        expect(screen.getByText(/Type: utxos/)).toBeInTheDocument();
      });
    });

    it('should handle summary query type', async () => {
      mockExecuteNaturalQuery.mockResolvedValue({
        type: 'summary',
        aggregation: 'count',
      });

      render(<AIQueryInput walletId={testWalletId} />);

      const input = screen.getByPlaceholderText('Ask about your transactions...');
      await userEvent.type(input, 'Count all transactions');

      const form = input.closest('form');
      fireEvent.submit(form!);

      await waitFor(() => {
        expect(screen.getByText(/Type: summary/)).toBeInTheDocument();
      });
    });
  });

  describe('Keyboard Navigation', () => {
    it('should submit on Enter key', async () => {
      render(<AIQueryInput walletId={testWalletId} />);

      const input = screen.getByPlaceholderText('Ask about your transactions...');
      await userEvent.type(input, 'Test query{enter}');

      await waitFor(() => {
        expect(mockExecuteNaturalQuery).toHaveBeenCalled();
      });
    });
  });

  describe('Default Export', () => {
    it('should export default component', () => {
      expect(AIQueryInputDefault).toBe(AIQueryInput);
    });
  });

  describe('Accessibility', () => {
    it('should have accessible input', () => {
      render(<AIQueryInput walletId={testWalletId} />);

      const input = screen.getByPlaceholderText('Ask about your transactions...');
      expect(input).toBeInTheDocument();
      expect(input.tagName).toBe('INPUT');
    });

    it('should have accessible submit button', () => {
      render(<AIQueryInput walletId={testWalletId} />);

      const buttons = screen.getAllByRole('button');
      expect(buttons.length).toBeGreaterThan(0);
    });
  });
});
