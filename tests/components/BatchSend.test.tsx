/**
 * BatchSend Component Tests
 *
 * Tests the batch transaction sending functionality.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, MemoryRouter, Route, Routes } from 'react-router-dom';

// Mock navigate
const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

// Mock bitcoin API
const mockCreateBatchTransaction = vi.fn();
vi.mock('../../src/api/bitcoin', () => ({
  createBatchTransaction: (...args: unknown[]) => mockCreateBatchTransaction(...args),
}));

// Mock currency context
vi.mock('../../contexts/CurrencyContext', () => ({
  useCurrency: () => ({
    format: (sats: number) => `${sats.toLocaleString()} sats`,
    getFiatValue: (sats: number) => sats * 0.0004, // Mock conversion
    currencySymbol: '$',
  }),
}));

// Mock logger
vi.mock('../../utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Mock lucide-react icons
vi.mock('lucide-react', () => ({
  ArrowLeft: () => <span data-testid="arrow-left" />,
  Plus: () => <span data-testid="plus-icon" />,
  X: () => <span data-testid="x-icon" />,
  Users: () => <span data-testid="users-icon" />,
  TrendingDown: () => <span data-testid="trending-down-icon" />,
  AlertTriangle: () => <span data-testid="alert-triangle-icon" />,
  Loader2: () => <span data-testid="loader-icon" />,
  CheckCircle: () => <span data-testid="check-circle-icon" />,
}));

// Mock Button component
vi.mock('../../components/ui/Button', () => ({
  Button: ({ children, onClick, disabled, size, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { size?: string }) => (
    <button onClick={onClick} disabled={disabled} data-size={size} {...props}>
      {children}
    </button>
  ),
}));

// Mock crypto.randomUUID for recipient IDs
const mockRandomUUID = vi.fn(() => 'mock-uuid-' + Math.random().toString(36).substr(2, 9));
Object.defineProperty(globalThis, 'crypto', {
  value: {
    randomUUID: mockRandomUUID,
  },
});

const createWrapper = (walletId: string = 'test-wallet-123') => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });

  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/wallets/${walletId}/batch`]}>
        <Routes>
          <Route path="/wallets/:id/batch" element={children} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
};

const createWrapperWithoutId = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });

  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/wallets/batch']}>
        <Routes>
          <Route path="/wallets/batch" element={children} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
};

describe('BatchSend Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render the batch send page', async () => {
    const { BatchSend } = await import('../../components/BatchSend');

    render(<BatchSend />, { wrapper: createWrapper() });

    expect(screen.getByText(/batch send/i)).toBeInTheDocument();
    expect(screen.getByText(/send to multiple recipients/i)).toBeInTheDocument();
  });

  it('should show back to wallet button', async () => {
    const { BatchSend } = await import('../../components/BatchSend');

    render(<BatchSend />, { wrapper: createWrapper() });

    expect(screen.getByText(/back to wallet/i)).toBeInTheDocument();
  });

  it('should navigate back when clicking back button', async () => {
    const { BatchSend } = await import('../../components/BatchSend');
    const user = userEvent.setup();

    render(<BatchSend />, { wrapper: createWrapper() });

    const backButton = screen.getByText(/back to wallet/i);
    await user.click(backButton);

    expect(mockNavigate).toHaveBeenCalledWith('/wallets/test-wallet-123');
  });

  it('should show benefits banner', async () => {
    const { BatchSend } = await import('../../components/BatchSend');

    render(<BatchSend />, { wrapper: createWrapper() });

    expect(screen.getByText(/save on transaction fees/i)).toBeInTheDocument();
    expect(screen.getByText(/batch transactions combine/i)).toBeInTheDocument();
  });

  it('should start with one empty recipient', async () => {
    const { BatchSend } = await import('../../components/BatchSend');

    render(<BatchSend />, { wrapper: createWrapper() });

    // Should show address and amount inputs
    expect(screen.getByPlaceholderText(/bc1q/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText('0')).toBeInTheDocument();

    // Should have exactly one address input (one recipient)
    const addressInputs = screen.getAllByPlaceholderText(/bc1q/i);
    expect(addressInputs).toHaveLength(1);
  });

  it('should allow adding more recipients', async () => {
    const { BatchSend } = await import('../../components/BatchSend');
    const user = userEvent.setup();

    render(<BatchSend />, { wrapper: createWrapper() });

    const addButton = screen.getByText(/add recipient/i);
    await user.click(addButton);

    // Should now have 2 address inputs
    const addressInputs = screen.getAllByPlaceholderText(/bc1q/i);
    expect(addressInputs).toHaveLength(2);
  });

  it('should allow entering recipient details', async () => {
    const { BatchSend } = await import('../../components/BatchSend');
    const user = userEvent.setup();

    render(<BatchSend />, { wrapper: createWrapper() });

    const addressInput = screen.getByPlaceholderText(/bc1q/i);
    const amountInput = screen.getByPlaceholderText('0');
    const labelInput = screen.getByPlaceholderText('Label (optional)');

    await user.type(labelInput, 'Payroll');
    await user.type(addressInput, 'bc1qtest123456789');
    await user.type(amountInput, '10000');

    expect(labelInput).toHaveValue('Payroll');
    expect(addressInput).toHaveValue('bc1qtest123456789');
    expect(amountInput).toHaveValue(10000);
  });

  it('should update total when amount is entered', async () => {
    const { BatchSend } = await import('../../components/BatchSend');
    const user = userEvent.setup();

    render(<BatchSend />, { wrapper: createWrapper() });

    const amountInput = screen.getByPlaceholderText('0');
    await user.type(amountInput, '10000');

    // Should show the total in the summary
    await waitFor(() => {
      expect(screen.getByText(/10,000 sats/)).toBeInTheDocument();
    });
  });

  it('should show fee rate input', async () => {
    const { BatchSend } = await import('../../components/BatchSend');

    render(<BatchSend />, { wrapper: createWrapper() });

    expect(screen.getByText(/network fee/i)).toBeInTheDocument();
    expect(screen.getByText(/fee rate/i)).toBeInTheDocument();

    // Default fee rate should be 10
    const feeInput = screen.getByDisplayValue('10');
    expect(feeInput).toBeInTheDocument();
  });

  it('should show fee comparison', async () => {
    const { BatchSend } = await import('../../components/BatchSend');

    render(<BatchSend />, { wrapper: createWrapper() });

    expect(screen.getByText(/individual transactions:/i)).toBeInTheDocument();
    expect(screen.getByText(/batch transaction:/i)).toBeInTheDocument();
    expect(screen.getByText(/estimated savings:/i)).toBeInTheDocument();
  });

  it('should show summary section', async () => {
    const { BatchSend } = await import('../../components/BatchSend');

    render(<BatchSend />, { wrapper: createWrapper() });

    expect(screen.getByRole('heading', { name: 'Summary' })).toBeInTheDocument();
    expect(screen.getByText('Total Amount')).toBeInTheDocument();
    expect(screen.getByText('Total Cost')).toBeInTheDocument();
  });

  it('should disable submit when total is zero', async () => {
    const { BatchSend } = await import('../../components/BatchSend');

    render(<BatchSend />, { wrapper: createWrapper() });

    const submitButton = screen.getByText(/create batch transaction/i);
    expect(submitButton).toBeDisabled();
  });

  it('should show error when no valid recipients', async () => {
    const { BatchSend } = await import('../../components/BatchSend');
    const user = userEvent.setup();

    render(<BatchSend />, { wrapper: createWrapper() });

    // Enter an amount but no valid address
    const amountInput = screen.getByPlaceholderText('0');
    await user.type(amountInput, '10000');

    const submitButton = screen.getByText(/create batch transaction/i);
    await user.click(submitButton);

    await waitFor(() => {
      expect(screen.getByText(/please add at least one valid recipient/i)).toBeInTheDocument();
    });
  });

  it('should show error for invalid address', async () => {
    const { BatchSend } = await import('../../components/BatchSend');
    const user = userEvent.setup();

    render(<BatchSend />, { wrapper: createWrapper() });

    const addressInput = screen.getByPlaceholderText(/bc1q/i);
    const amountInput = screen.getByPlaceholderText('0');

    await user.type(addressInput, 'short');
    await user.type(amountInput, '10000');

    const submitButton = screen.getByText(/create batch transaction/i);
    await user.click(submitButton);

    await waitFor(() => {
      expect(screen.getByText(/invalid address/i)).toBeInTheDocument();
    });
  });

  it('should create batch transaction successfully', async () => {
    mockCreateBatchTransaction.mockResolvedValue({
      recipientCount: 1,
      totalOutput: 10000,
      fee: 300,
      savedFees: 450,
    });

    const { BatchSend } = await import('../../components/BatchSend');
    const user = userEvent.setup();

    render(<BatchSend />, { wrapper: createWrapper() });

    const addressInput = screen.getByPlaceholderText(/bc1q/i);
    const amountInput = screen.getByPlaceholderText('0');

    await user.type(addressInput, 'bc1qtest123456789012345');
    await user.type(amountInput, '10000');

    const submitButton = screen.getByText(/create batch transaction/i);
    await user.click(submitButton);

    await waitFor(() => {
      expect(mockCreateBatchTransaction).toHaveBeenCalledWith({
        recipients: [
          {
            address: 'bc1qtest123456789012345',
            amount: 10000,
            label: '',
          },
        ],
        feeRate: 10,
        walletId: 'test-wallet-123',
      });
    });

    // Should show success message
    await waitFor(() => {
      expect(screen.getByText(/batch transaction created successfully/i)).toBeInTheDocument();
    });
  });
});

describe('BatchSend Component - Multiple Recipients', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should allow removing a recipient when more than one exists', async () => {
    const { BatchSend } = await import('../../components/BatchSend');
    const user = userEvent.setup();

    render(<BatchSend />, { wrapper: createWrapper() });

    // Add a second recipient
    const addButton = screen.getByText(/add recipient/i);
    await user.click(addButton);

    // Should have 2 recipients now
    let addressInputs = screen.getAllByPlaceholderText(/bc1q/i);
    expect(addressInputs).toHaveLength(2);

    // Find and click the remove button (X icon)
    const removeButtons = screen.getAllByTestId('x-icon');
    await user.click(removeButtons[0].closest('button')!);

    // Should be back to 1 recipient
    addressInputs = screen.getAllByPlaceholderText(/bc1q/i);
    expect(addressInputs).toHaveLength(1);
  });

  it('should not allow removing the last recipient', async () => {
    const { BatchSend } = await import('../../components/BatchSend');

    render(<BatchSend />, { wrapper: createWrapper() });

    // With only 1 recipient, there should be no remove button visible
    const removeButtons = screen.queryAllByTestId('x-icon');
    expect(removeButtons).toHaveLength(0);
  });

  it('should update recipient count display', async () => {
    const { BatchSend } = await import('../../components/BatchSend');
    const user = userEvent.setup();

    render(<BatchSend />, { wrapper: createWrapper() });

    // Check initial state - one address input
    let addressInputs = screen.getAllByPlaceholderText(/bc1q/i);
    expect(addressInputs).toHaveLength(1);

    const addButton = screen.getByText(/add recipient/i);
    await user.click(addButton);

    // Check after adding - two address inputs
    addressInputs = screen.getAllByPlaceholderText(/bc1q/i);
    expect(addressInputs).toHaveLength(2);

    await user.click(addButton);

    // Check after adding another - three address inputs
    addressInputs = screen.getAllByPlaceholderText(/bc1q/i);
    expect(addressInputs).toHaveLength(3);
  });
});

describe('BatchSend Component - Branch Coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('removeRecipientById keeps a single recipient unchanged', async () => {
    const { removeRecipientById } = await import('../../components/BatchSend');

    const recipients = [{ id: 'r1', address: 'bc1qsingle', amount: '10', label: 'one' }];
    expect(removeRecipientById(recipients as any, 'r1')).toEqual(recipients);
  });

  it('removeRecipientById removes matching recipient when multiple exist', async () => {
    const { removeRecipientById } = await import('../../components/BatchSend');

    const recipients = [
      { id: 'r1', address: 'bc1qa', amount: '10', label: 'a' },
      { id: 'r2', address: 'bc1qb', amount: '20', label: 'b' },
    ];
    expect(removeRecipientById(recipients as any, 'r1')).toEqual([recipients[1]]);
  });

  it('keeps other recipients unchanged when updating one recipient', async () => {
    const { BatchSend } = await import('../../components/BatchSend');
    const user = userEvent.setup();

    render(<BatchSend />, { wrapper: createWrapper() });

    await user.click(screen.getByText(/add recipient/i));
    const addressInputs = screen.getAllByPlaceholderText(/bc1q/i);

    await user.type(addressInputs[0], 'bc1qfirstrecipient0001');
    expect(addressInputs[0]).toHaveValue('bc1qfirstrecipient0001');
    expect(addressInputs[1]).toHaveValue('');
  });

  it('returns early when wallet id is missing', async () => {
    const { BatchSend } = await import('../../components/BatchSend');
    const user = userEvent.setup();

    render(<BatchSend />, { wrapper: createWrapperWithoutId() });

    await user.type(screen.getByPlaceholderText(/bc1q/i), 'bc1qtest123456789012345');
    await user.type(screen.getByPlaceholderText('0'), '10000');
    await user.click(screen.getByText(/create batch transaction/i));

    expect(mockCreateBatchTransaction).not.toHaveBeenCalled();
    expect(screen.queryByText(/please add at least one valid recipient/i)).not.toBeInTheDocument();
  });

  it('shows API error message when batch creation fails', async () => {
    mockCreateBatchTransaction.mockRejectedValue(new Error('Backend failed'));
    const { BatchSend } = await import('../../components/BatchSend');
    const user = userEvent.setup();

    render(<BatchSend />, { wrapper: createWrapper() });

    await user.type(screen.getByPlaceholderText(/bc1q/i), 'bc1qtest123456789012345');
    await user.type(screen.getByPlaceholderText('0'), '10000');
    await user.click(screen.getByText(/create batch transaction/i));

    await waitFor(() => {
      expect(screen.getByText('Backend failed')).toBeInTheDocument();
    });
  });

  it('uses fallback API error text when thrown error has no message', async () => {
    mockCreateBatchTransaction.mockRejectedValue({ message: '' });
    const { BatchSend } = await import('../../components/BatchSend');
    const user = userEvent.setup();

    render(<BatchSend />, { wrapper: createWrapper() });

    await user.type(screen.getByPlaceholderText(/bc1q/i), 'bc1qtest123456789012345');
    await user.type(screen.getByPlaceholderText('0'), '10000');
    await user.click(screen.getByText(/create batch transaction/i));

    await waitFor(() => {
      expect(screen.getByText('Failed to create batch transaction')).toBeInTheDocument();
    });
  });

  it('updates fee rate from numeric input and falls back to zero for blank input', async () => {
    const { BatchSend } = await import('../../components/BatchSend');
    const user = userEvent.setup();

    render(<BatchSend />, { wrapper: createWrapper() });

    const feeInput = screen.getByDisplayValue('10');
    await user.clear(feeInput);
    await user.type(feeInput, '12.5');
    expect(screen.getByDisplayValue('12.5')).toBeInTheDocument();

    await user.clear(screen.getByDisplayValue('12.5'));
    expect(screen.getByDisplayValue('0')).toBeInTheDocument();
  });

});
