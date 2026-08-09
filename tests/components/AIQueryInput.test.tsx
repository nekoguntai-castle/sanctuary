/**
 * AIQueryInput Component Tests
 *
 * Tests for the AI natural language query input component.
 * Covers rendering, user interactions, query execution, and error handling.
 */

import { act,fireEvent,render,renderHook,screen,waitFor } from '@testing-library/react';
import type { ComponentProps } from 'react';
import userEvent from '@testing-library/user-event';
import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';

// Mock the AI API
const mockExecuteNaturalQuery = vi.fn();

vi.mock('../../src/api/ai', () => ({
  executeNaturalQuery: (req: { query: string; walletId: string }, signal?: AbortSignal) =>
    mockExecuteNaturalQuery(req, signal),
}));

// Mock the logger
vi.mock('../../src/utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Import component after mocks
import {
  AIQueryInput as OwnedAIQueryInput,
  default as AIQueryInputDefault,
} from '../../src/components/AIQueryInput';
import { useAIQueryInputController } from '../../src/components/AIQueryInput/useAIQueryInputController';

// Test data
const testWalletId = 'wallet-test-001';
type AIQueryInputProps = ComponentProps<typeof OwnedAIQueryInput>;
const AIQueryInput = ({
  ownershipKey = `${testWalletId}:user-test:mainnet`,
  ...props
}: Omit<AIQueryInputProps, 'ownershipKey'> & Partial<Pick<AIQueryInputProps, 'ownershipKey'>>) => (
  <OwnedAIQueryInput {...props} ownershipKey={ownershipKey} />
);

const mockQueryResult = {
  type: 'transactions' as const,
  filter: { type: 'receive' },
  sort: { field: 'amount', order: 'desc' as const },
  limit: 10,
};

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
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

      expect(screen.getByPlaceholderText('Filter transactions with AI...')).toBeInTheDocument();
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

      expect(screen.queryByText('AI transaction filter:')).not.toBeInTheDocument();
    });

    it('should not show error initially', () => {
      render(<AIQueryInput walletId={testWalletId} />);

      expect(screen.queryByText(/Failed to process query/)).not.toBeInTheDocument();
    });
  });

  describe('Example Queries', () => {
    it('should show example queries when input is focused and empty', async () => {
      render(<AIQueryInput walletId={testWalletId} />);

      const input = screen.getByPlaceholderText('Filter transactions with AI...');
      fireEvent.focus(input);

      await waitFor(() => {
        expect(screen.getByText('Try asking...')).toBeInTheDocument();
      });
    });

    it('should display predefined example queries', async () => {
      render(<AIQueryInput walletId={testWalletId} />);

      const input = screen.getByPlaceholderText('Filter transactions with AI...');
      fireEvent.focus(input);

      await waitFor(() => {
        expect(screen.getByText('Show my largest receives')).toBeInTheDocument();
      });
    });

    it('should fill input when example is clicked', async () => {
      render(<AIQueryInput walletId={testWalletId} />);

      const input = screen.getByPlaceholderText('Filter transactions with AI...') as HTMLInputElement;
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

      const input = screen.getByPlaceholderText('Filter transactions with AI...');
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

      const input = screen.getByPlaceholderText('Filter transactions with AI...');
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

      const input = screen.getByPlaceholderText('Filter transactions with AI...');
      await userEvent.type(input, 'Show my transactions');

      const form = input.closest('form');
      fireEvent.submit(form!);

      await waitFor(() => {
        expect(mockExecuteNaturalQuery).toHaveBeenCalledWith({
          query: 'Show my transactions',
          walletId: testWalletId,
        }, expect.anything());
      });
    });

    it('should not submit empty query', async () => {
      render(<AIQueryInput walletId={testWalletId} />);

      const form = screen.getByPlaceholderText('Filter transactions with AI...').closest('form');
      fireEvent.submit(form!);

      expect(mockExecuteNaturalQuery).not.toHaveBeenCalled();
    });

    it('should not submit whitespace-only query', async () => {
      render(<AIQueryInput walletId={testWalletId} />);

      const input = screen.getByPlaceholderText('Filter transactions with AI...');
      await userEvent.type(input, '   ');

      const form = input.closest('form');
      fireEvent.submit(form!);

      expect(mockExecuteNaturalQuery).not.toHaveBeenCalled();
    });

    it('should trim query before submission', async () => {
      render(<AIQueryInput walletId={testWalletId} />);

      const input = screen.getByPlaceholderText('Filter transactions with AI...');
      await userEvent.type(input, '  Show transactions  ');

      const form = input.closest('form');
      fireEvent.submit(form!);

      await waitFor(() => {
        expect(mockExecuteNaturalQuery).toHaveBeenCalledWith({
          query: 'Show transactions',
          walletId: testWalletId,
        }, expect.anything());
      });
    });

    it('should pass walletId to API', async () => {
      const customWalletId = 'custom-wallet-123';
      render(<AIQueryInput walletId={customWalletId} />);

      const input = screen.getByPlaceholderText('Filter transactions with AI...');
      await userEvent.type(input, 'Test query');

      const form = input.closest('form');
      fireEvent.submit(form!);

      await waitFor(() => {
        expect(mockExecuteNaturalQuery).toHaveBeenCalledWith({
          query: 'Test query',
          walletId: customWalletId,
        }, expect.anything());
      });
    });
  });

  describe('Loading State', () => {
    it('should show loading state during query execution', async () => {
      mockExecuteNaturalQuery.mockImplementation(
        () => new Promise<never>(() => undefined)
      );

      render(<AIQueryInput walletId={testWalletId} />);

      const input = screen.getByPlaceholderText('Filter transactions with AI...');
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
        () => new Promise<never>(() => undefined)
      );

      render(<AIQueryInput walletId={testWalletId} />);

      const input = screen.getByPlaceholderText('Filter transactions with AI...') as HTMLInputElement;
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

      const input = screen.getByPlaceholderText('Filter transactions with AI...');
      await userEvent.type(input, 'Show largest receives');

      const form = input.closest('form');
      fireEvent.submit(form!);

      await waitFor(() => {
        expect(screen.getByText('AI transaction filter:')).toBeInTheDocument();
      });
    });

    it('should display query type in result', async () => {
      render(<AIQueryInput walletId={testWalletId} />);

      const input = screen.getByPlaceholderText('Filter transactions with AI...');
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

      const input = screen.getByPlaceholderText('Filter transactions with AI...');
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

      const input = screen.getByPlaceholderText('Filter transactions with AI...');
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

      const input = screen.getByPlaceholderText('Filter transactions with AI...');
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

      const input = screen.getByPlaceholderText('Filter transactions with AI...');
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

      const input = screen.getByPlaceholderText('Filter transactions with AI...');
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

      const input = screen.getByPlaceholderText('Filter transactions with AI...');
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

      const input = screen.getByPlaceholderText('Filter transactions with AI...');
      await userEvent.type(input, 'Test query');

      const form = input.closest('form');
      fireEvent.submit(form!);

      await waitFor(() => {
        expect(screen.getByText(/rate limit reached/i)).toBeInTheDocument();
      });
    });

    it('should display generic error for other failures', async () => {
      mockExecuteNaturalQuery.mockRejectedValue(new Error('Network error'));

      render(<AIQueryInput walletId={testWalletId} />);

      const input = screen.getByPlaceholderText('Filter transactions with AI...');
      await userEvent.type(input, 'Test query');

      const form = input.closest('form');
      fireEvent.submit(form!);

      await waitFor(() => {
        expect(screen.getByText(/Failed to process query/)).toBeInTheDocument();
      });
    });

    it('should handle non-Error thrown values gracefully', async () => {
      mockExecuteNaturalQuery.mockRejectedValue('string-error');

      render(<AIQueryInput walletId={testWalletId} />);

      const input = screen.getByPlaceholderText('Filter transactions with AI...');
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

      const input = screen.getByPlaceholderText('Filter transactions with AI...');
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

      const input = screen.getByPlaceholderText('Filter transactions with AI...');
      await userEvent.type(input, 'Test query');

      // Look for the X button
      const buttons = screen.getAllByRole('button');
      expect(buttons.length).toBeGreaterThan(1); // Clear + Submit buttons
    });

    it('should clear input when clear button is clicked', async () => {
      render(<AIQueryInput walletId={testWalletId} />);

      const input = screen.getByPlaceholderText('Filter transactions with AI...') as HTMLInputElement;
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

      const input = screen.getByPlaceholderText('Filter transactions with AI...');
      await userEvent.type(input, 'Test query');

      const form = input.closest('form');
      fireEvent.submit(form!);

      await waitFor(() => {
        expect(screen.getByText('AI transaction filter:')).toBeInTheDocument();
      });

      // Clear the input
      const buttons = screen.getAllByRole('button');
      const clearButton = buttons.find(btn => btn.getAttribute('type') === 'button');

      if (clearButton) {
        fireEvent.click(clearButton);
      }

      await waitFor(() => {
        expect(screen.queryByText('AI transaction filter:')).not.toBeInTheDocument();
      });
    });

    it('should clear the parent transaction filter when input is cleared', async () => {
      const onQueryResult = vi.fn();
      render(<AIQueryInput walletId={testWalletId} onQueryResult={onQueryResult} />);

      const input = screen.getByPlaceholderText('Filter transactions with AI...');
      await userEvent.type(input, 'Show receives');

      fireEvent.click(screen.getByLabelText('Clear AI transaction filter'));

      await waitFor(() => {
        expect(onQueryResult).toHaveBeenCalledWith(null);
      });
    });

    it('should clear error when input is cleared', async () => {
      mockExecuteNaturalQuery.mockRejectedValue(new Error('Test error'));

      render(<AIQueryInput walletId={testWalletId} />);

      const input = screen.getByPlaceholderText('Filter transactions with AI...');
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

  describe('Request ownership', () => {
    it('rejects captured A field and clear handlers after ownership changes', () => {
      const onQueryResult = vi.fn();
      const view = renderHook(
        ({ ownershipKey }) => useAIQueryInputController({
          walletId: ownershipKey.startsWith('wallet-a') ? 'wallet-a' : 'wallet-b',
          ownershipKey,
          onQueryResult,
        }),
        { initialProps: { ownershipKey: 'wallet-a:user-1:mainnet' } }
      );
      const setAQuery = view.result.current.setQuery;
      const clearAQuery = view.result.current.clearQuery;

      view.rerender({ ownershipKey: 'wallet-b:user-1:testnet' });
      act(() => {
        setAQuery('stale A query');
        clearAQuery();
      });

      expect(view.result.current.query).toBe('');
      expect(onQueryResult).not.toHaveBeenCalled();
    });

    it('renders empty B state immediately and rejects A completion after an ownership change', async () => {
      const pending = deferred<typeof mockQueryResult>();
      const onQueryResult = vi.fn();
      mockExecuteNaturalQuery.mockReturnValue(pending.promise);
      const view = render(
        <AIQueryInput
          walletId="wallet-a"
          ownershipKey="wallet-a:user-1:mainnet"
          onQueryResult={onQueryResult}
        />
      );

      const inputA = screen.getByPlaceholderText('Filter transactions with AI...');
      await userEvent.type(inputA, 'wallet A query');
      fireEvent.submit(inputA.closest('form')!);
      await waitFor(() => expect(inputA).toBeDisabled());
      const signal = mockExecuteNaturalQuery.mock.calls[0][1] as AbortSignal;

      view.rerender(
        <AIQueryInput
          walletId="wallet-b"
          ownershipKey="wallet-b:user-1:testnet"
          onQueryResult={onQueryResult}
        />
      );

      const inputB = screen.getByPlaceholderText('Filter transactions with AI...') as HTMLInputElement;
      expect(inputB.value).toBe('');
      expect(inputB).toBeEnabled();
      expect(screen.queryByText('AI transaction filter:')).not.toBeInTheDocument();
      expect(screen.queryByText(/Failed to process query/)).not.toBeInTheDocument();
      expect(screen.queryByText('Try asking...')).not.toBeInTheDocument();
      expect(signal.aborted).toBe(true);

      await act(async () => {
        pending.reject(new Error('wallet A failed'));
        await pending.promise.catch(() => undefined);
      });
      expect(onQueryResult).not.toHaveBeenCalled();
      expect(screen.queryByText(/Failed to process query/)).not.toBeInTheDocument();

      view.rerender(
        <AIQueryInput
          walletId="wallet-a"
          ownershipKey="wallet-a:user-1:mainnet"
          onQueryResult={onQueryResult}
        />
      );
      const revisitedA = screen.getByPlaceholderText('Filter transactions with AI...') as HTMLInputElement;
      expect(revisitedA.value).toBe('');
      expect(revisitedA).toBeEnabled();
    });

    it('does not deliver a deferred result after the input unmounts', async () => {
      const pending = deferred<typeof mockQueryResult>();
      const onQueryResult = vi.fn();
      mockExecuteNaturalQuery.mockReturnValue(pending.promise);
      const view = render(
        <AIQueryInput
          walletId="wallet-a"
          ownershipKey="wallet-a:user-1:mainnet"
          onQueryResult={onQueryResult}
        />
      );

      const input = screen.getByPlaceholderText('Filter transactions with AI...');
      await userEvent.type(input, 'wallet A query');
      fireEvent.submit(input.closest('form')!);
      const signal = mockExecuteNaturalQuery.mock.calls[0][1] as AbortSignal;

      view.unmount();
      expect(signal.aborted).toBe(true);
      await act(async () => {
        pending.resolve(mockQueryResult);
        await pending.promise;
      });

      expect(onQueryResult).not.toHaveBeenCalled();
    });

    it('invalidates and aborts a pending query when clear is clicked', async () => {
      const pending = deferred<typeof mockQueryResult>();
      const onQueryResult = vi.fn();
      mockExecuteNaturalQuery.mockReturnValue(pending.promise);
      render(
        <AIQueryInput
          walletId={testWalletId}
          ownershipKey={`${testWalletId}:user-1:mainnet`}
          onQueryResult={onQueryResult}
        />
      );

      const input = screen.getByPlaceholderText('Filter transactions with AI...') as HTMLInputElement;
      await userEvent.type(input, 'pending query');
      fireEvent.submit(input.closest('form')!);
      await waitFor(() => expect(input).toBeDisabled());
      const signal = mockExecuteNaturalQuery.mock.calls[0][1] as AbortSignal;

      fireEvent.click(screen.getByLabelText('Clear AI transaction filter'));
      expect(signal.aborted).toBe(true);
      expect(input.value).toBe('');
      expect(input).toBeEnabled();

      await act(async () => {
        pending.resolve(mockQueryResult);
        await pending.promise;
      });
      expect(onQueryResult).toHaveBeenCalledTimes(1);
      expect(onQueryResult).toHaveBeenCalledWith(null);
      expect(screen.queryByText('AI transaction filter:')).not.toBeInTheDocument();
    });

    it('keeps the newer request loading and result when requests settle in reverse order', async () => {
      const first = deferred<typeof mockQueryResult>();
      const second = deferred<typeof mockQueryResult>();
      const newerResult = { ...mockQueryResult, filter: { type: 'send' } };
      mockExecuteNaturalQuery
        .mockReturnValueOnce(first.promise)
        .mockReturnValueOnce(second.promise);
      render(
        <AIQueryInput
          walletId={testWalletId}
          ownershipKey={`${testWalletId}:user-1:mainnet`}
        />
      );

      const input = screen.getByPlaceholderText('Filter transactions with AI...') as HTMLInputElement;
      await userEvent.type(input, 'first query');
      fireEvent.submit(input.closest('form')!);
      await waitFor(() => expect(input).toBeDisabled());
      fireEvent.click(screen.getByLabelText('Clear AI transaction filter'));
      await userEvent.type(input, 'second query');
      fireEvent.submit(input.closest('form')!);
      await waitFor(() => expect(mockExecuteNaturalQuery).toHaveBeenCalledTimes(2));

      await act(async () => {
        first.resolve(mockQueryResult);
        await first.promise;
      });
      expect(input).toBeDisabled();
      expect(screen.queryByText(/Filter:.*receive/)).not.toBeInTheDocument();

      await act(async () => {
        second.resolve(newerResult);
        await second.promise;
      });
      expect(input).toBeEnabled();
      expect(screen.getByText(/Filter:.*send/)).toBeInTheDocument();
    });

    it('does not paint A examples or a completed result under B', async () => {
      const view = render(
        <AIQueryInput walletId="wallet-a" ownershipKey="wallet-a:user-1:mainnet" />
      );
      const input = screen.getByPlaceholderText('Filter transactions with AI...');
      fireEvent.focus(input);
      expect(screen.getByText('Try asking...')).toBeInTheDocument();

      view.rerender(
        <AIQueryInput walletId="wallet-b" ownershipKey="wallet-b:user-2:signet" />
      );
      expect(screen.queryByText('Try asking...')).not.toBeInTheDocument();

      await userEvent.type(screen.getByPlaceholderText('Filter transactions with AI...'), 'B query');
      fireEvent.submit(screen.getByPlaceholderText('Filter transactions with AI...').closest('form')!);
      await waitFor(() => expect(screen.getByText('AI transaction filter:')).toBeInTheDocument());

      view.rerender(
        <AIQueryInput walletId="wallet-c" ownershipKey="wallet-c:user-2:signet" />
      );
      expect(screen.queryByText('AI transaction filter:')).not.toBeInTheDocument();
    });
  });

  describe('Query Types', () => {
    it('should handle transactions query type', async () => {
      mockExecuteNaturalQuery.mockResolvedValue({
        type: 'transactions',
        filter: {},
      });

      render(<AIQueryInput walletId={testWalletId} />);

      const input = screen.getByPlaceholderText('Filter transactions with AI...');
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

      const input = screen.getByPlaceholderText('Filter transactions with AI...');
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

      const input = screen.getByPlaceholderText('Filter transactions with AI...');
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

      const input = screen.getByPlaceholderText('Filter transactions with AI...');
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

      const input = screen.getByPlaceholderText('Filter transactions with AI...');
      await userEvent.type(input, 'Test query{enter}');

      await waitFor(() => {
        expect(mockExecuteNaturalQuery).toHaveBeenCalled();
      });
    });
  });

  describe('Default Export', () => {
    it('should export default component', () => {
      expect(AIQueryInputDefault).toBe(OwnedAIQueryInput);
    });
  });

  describe('Accessibility', () => {
    it('should have accessible input', () => {
      render(<AIQueryInput walletId={testWalletId} />);

      const input = screen.getByPlaceholderText('Filter transactions with AI...');
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
