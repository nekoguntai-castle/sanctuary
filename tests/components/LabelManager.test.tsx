/**
 * LabelManager Component Tests
 *
 * Tests for the label management component including CRUD operations.
 */

import { fireEvent,render,screen,waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { beforeEach,describe,expect,it,vi } from 'vitest';
import { LabelManager } from '../../src/components/LabelManager';
import type { Label } from '../../src/types';

vi.mock('../../src/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Mock mutation functions — each mutation gets its own mock
const mockCreateMutateAsync = vi.fn();
const mockUpdateMutateAsync = vi.fn();
const mockDeleteMutateAsync = vi.fn();
const mockCreateReset = vi.fn();
const mockUpdateReset = vi.fn();
const mockDeleteReset = vi.fn();

// Default hook return values (overridden per-test as needed)
let mockUseWalletLabelsReturn: { data: Label[] | undefined; isLoading: boolean; error: unknown };
let mockCreateMutationReturn: { mutateAsync: typeof mockCreateMutateAsync; isPending: boolean; error: unknown; reset: typeof mockCreateReset };
let mockUpdateMutationReturn: { mutateAsync: typeof mockUpdateMutateAsync; isPending: boolean; error: unknown; reset: typeof mockUpdateReset };
let mockDeleteMutationReturn: { mutateAsync: typeof mockDeleteMutateAsync; isPending: boolean; error: unknown; reset: typeof mockDeleteReset };

vi.mock('../../src/hooks/queries/useWalletLabels', () => ({
  useWalletLabels: () => mockUseWalletLabelsReturn,
  useCreateWalletLabel: () => mockCreateMutationReturn,
  useUpdateWalletLabel: () => mockUpdateMutationReturn,
  useDeleteWalletLabel: () => mockDeleteMutationReturn,
}));

const mockLabels: Label[] = [
  {
    id: 'label-1',
    walletId: 'wallet-123',
    name: 'Exchange',
    color: '#6366f1',
    description: 'Exchange deposits',
    transactionCount: 5,
    addressCount: 2,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  },
  {
    id: 'label-2',
    walletId: 'wallet-123',
    name: 'Savings',
    color: '#22c55e',
    transactionCount: 10,
    addressCount: 3,
    createdAt: '2024-01-02T00:00:00Z',
    updatedAt: '2024-01-02T00:00:00Z',
  },
];

describe('LabelManager', () => {
  const walletId = 'wallet-123';
  const mockOnLabelsChange = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    // Default: loaded state with labels
    mockUseWalletLabelsReturn = { data: mockLabels, isLoading: false, error: null };
    mockCreateMutationReturn = { mutateAsync: mockCreateMutateAsync, isPending: false, error: null, reset: mockCreateReset };
    mockUpdateMutationReturn = { mutateAsync: mockUpdateMutateAsync, isPending: false, error: null, reset: mockUpdateReset };
    mockDeleteMutationReturn = { mutateAsync: mockDeleteMutateAsync, isPending: false, error: null, reset: mockDeleteReset };
  });

  describe('loading state', () => {
    it('should show loading spinner initially', () => {
      mockUseWalletLabelsReturn = { data: undefined, isLoading: true, error: null };

      const { container } = render(<LabelManager walletId={walletId} />);

      // Check for the spinner element
      const spinner = container.querySelector('.animate-spin');
      expect(spinner).not.toBeNull();
    });
  });

  describe('rendering labels', () => {
    it('should render labels after loading', async () => {
      render(<LabelManager walletId={walletId} />);

      await waitFor(() => {
        expect(screen.getByText('Exchange')).toBeInTheDocument();
        expect(screen.getByText('Savings')).toBeInTheDocument();
      });
    });

    it('should show label descriptions', async () => {
      render(<LabelManager walletId={walletId} />);

      await waitFor(() => {
        expect(screen.getByText('Exchange deposits')).toBeInTheDocument();
      });
    });

    it('should show transaction and address counts', async () => {
      render(<LabelManager walletId={walletId} />);

      await waitFor(() => {
        expect(screen.getByText('5 txs')).toBeInTheDocument();
        expect(screen.getByText('2 addrs')).toBeInTheDocument();
      });
    });

    it('should display header with Labels title', async () => {
      render(<LabelManager walletId={walletId} />);

      await waitFor(() => {
        expect(screen.getByText('Labels')).toBeInTheDocument();
      });
    });

    it('should show New Label button', async () => {
      render(<LabelManager walletId={walletId} />);

      await waitFor(() => {
        expect(screen.getByText('New Label')).toBeInTheDocument();
      });
    });
  });

  describe('empty state', () => {
    it('should show empty state when no labels', async () => {
      mockUseWalletLabelsReturn = { data: [], isLoading: false, error: null };

      render(<LabelManager walletId={walletId} />);

      await waitFor(() => {
        expect(screen.getByText('No labels created yet.')).toBeInTheDocument();
        expect(screen.getByText('Create labels to organize your transactions and addresses.')).toBeInTheDocument();
      });
    });
  });

  describe('error handling', () => {
    it('should show error message on load failure', async () => {
      mockUseWalletLabelsReturn = { data: undefined, isLoading: false, error: new Error('Network error') };

      render(<LabelManager walletId={walletId} />);

      await waitFor(() => {
        expect(screen.getByText('Network error')).toBeInTheDocument();
      });
    });

    it('should show default error message', async () => {
      mockUseWalletLabelsReturn = { data: undefined, isLoading: false, error: {} };

      render(<LabelManager walletId={walletId} />);

      await waitFor(() => {
        expect(screen.getByText('An unexpected error occurred')).toBeInTheDocument();
      });
    });
  });

  describe('creating labels', () => {
    it('should open create form when New Label clicked', async () => {
      render(<LabelManager walletId={walletId} />);

      await waitFor(() => {
        expect(screen.getByText('New Label')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText('New Label'));

      expect(screen.getByText('Create New Label')).toBeInTheDocument();
      expect(screen.getByPlaceholderText('e.g., Exchange, Donation, Business')).toBeInTheDocument();
    });

    it('should show color picker in form', async () => {
      render(<LabelManager walletId={walletId} />);

      await waitFor(() => {
        expect(screen.getByText('New Label')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText('New Label'));

      expect(screen.getByText('Color')).toBeInTheDocument();
      // Should have 12 color buttons
      const colorButtons = screen.getAllByRole('button').filter(
        (btn) => btn.style.backgroundColor
      );
      expect(colorButtons.length).toBeGreaterThanOrEqual(12);
    });

    it('should show preview with label name', async () => {
      render(<LabelManager walletId={walletId} />);

      await waitFor(() => {
        expect(screen.getByText('New Label')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText('New Label'));

      const nameInput = screen.getByPlaceholderText('e.g., Exchange, Donation, Business');
      fireEvent.change(nameInput, { target: { value: 'Test Label' } });

      expect(screen.getByText('Test Label')).toBeInTheDocument();
    });

    it('should create label on save', async () => {
      mockCreateMutateAsync.mockResolvedValue({
        id: 'new-label',
        walletId,
        name: 'New Label',
        color: '#6366f1',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      render(<LabelManager walletId={walletId} onLabelsChange={mockOnLabelsChange} />);

      await waitFor(() => {
        expect(screen.getByText('New Label')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText('New Label'));

      const nameInput = screen.getByPlaceholderText('e.g., Exchange, Donation, Business');
      fireEvent.change(nameInput, { target: { value: 'New Label' } });

      fireEvent.click(screen.getByText('Create Label'));

      await waitFor(() => {
        expect(mockCreateMutateAsync).toHaveBeenCalledWith({
          walletId,
          data: {
            name: 'New Label',
            color: '#6366f1',
            description: undefined,
          },
        });
      });

      expect(mockOnLabelsChange).toHaveBeenCalled();
    });

    it('should disable save button when name is empty', async () => {
      render(<LabelManager walletId={walletId} />);

      await waitFor(() => {
        expect(screen.getByText('New Label')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText('New Label'));

      const createButton = screen.getByText('Create Label');
      expect(createButton).toBeDisabled();
    });

    it('should cancel form when Cancel clicked', async () => {
      render(<LabelManager walletId={walletId} />);

      await waitFor(() => {
        expect(screen.getByText('New Label')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText('New Label'));
      expect(screen.getByText('Create New Label')).toBeInTheDocument();

      fireEvent.click(screen.getByText('Cancel'));
      expect(screen.queryByText('Create New Label')).not.toBeInTheDocument();
    });
  });

  describe('editing labels', () => {
    it('should open edit form when edit button clicked', async () => {
      render(<LabelManager walletId={walletId} />);

      await waitFor(() => {
        expect(screen.getByText('Exchange')).toBeInTheDocument();
      });

      const editButtons = screen.getAllByTitle('Edit label');
      fireEvent.click(editButtons[0]);

      expect(screen.getByText('Edit Label')).toBeInTheDocument();
      expect(screen.getByDisplayValue('Exchange')).toBeInTheDocument();
      expect(screen.getByDisplayValue('Exchange deposits')).toBeInTheDocument();
    });

    it('should default description to empty when editing a label without description', async () => {
      render(<LabelManager walletId={walletId} />);

      await waitFor(() => {
        expect(screen.getByText('Savings')).toBeInTheDocument();
      });

      const editButtons = screen.getAllByTitle('Edit label');
      fireEvent.click(editButtons[1]);

      expect(screen.getByText('Edit Label')).toBeInTheDocument();
      const descriptionInput = screen.getByPlaceholderText('Optional description for this label') as HTMLInputElement;
      expect(descriptionInput.value).toBe('');
    });

    it('should update label on save', async () => {
      mockUpdateMutateAsync.mockResolvedValue({
        ...mockLabels[0],
        name: 'Updated Exchange',
      });

      render(<LabelManager walletId={walletId} onLabelsChange={mockOnLabelsChange} />);

      await waitFor(() => {
        expect(screen.getByText('Exchange')).toBeInTheDocument();
      });

      const editButtons = screen.getAllByTitle('Edit label');
      fireEvent.click(editButtons[0]);

      const nameInput = screen.getByDisplayValue('Exchange');
      fireEvent.change(nameInput, { target: { value: 'Updated Exchange' } });

      fireEvent.click(screen.getByText('Save Changes'));

      await waitFor(() => {
        expect(mockUpdateMutateAsync).toHaveBeenCalledWith({
          walletId,
          labelId: 'label-1',
          data: {
            name: 'Updated Exchange',
            color: '#6366f1',
            description: 'Exchange deposits',
          },
        });
      });

      expect(mockOnLabelsChange).toHaveBeenCalled();
    });

    it('should send undefined description when edit description is whitespace', async () => {
      mockUpdateMutateAsync.mockResolvedValue({
        ...mockLabels[0],
        description: undefined,
      });

      render(<LabelManager walletId={walletId} />);

      await waitFor(() => {
        expect(screen.getByText('Exchange')).toBeInTheDocument();
      });

      const editButtons = screen.getAllByTitle('Edit label');
      fireEvent.click(editButtons[0]);

      const descriptionInput = screen.getByDisplayValue('Exchange deposits');
      fireEvent.change(descriptionInput, { target: { value: '   ' } });

      fireEvent.click(screen.getByText('Save Changes'));

      await waitFor(() => {
        expect(mockUpdateMutateAsync).toHaveBeenCalledWith({
          walletId,
          labelId: 'label-1',
          data: {
            name: 'Exchange',
            color: '#6366f1',
            description: undefined,
          },
        });
      });
    });
  });

  describe('deleting labels', () => {
    it('should show delete confirmation when delete clicked', async () => {
      render(<LabelManager walletId={walletId} />);

      await waitFor(() => {
        expect(screen.getByText('Exchange')).toBeInTheDocument();
      });

      const deleteButtons = screen.getAllByTitle('Delete label');
      fireEvent.click(deleteButtons[0]);

      // Should show confirm/cancel buttons
      expect(screen.getByTitle('Confirm delete')).toBeInTheDocument();
      expect(screen.getByTitle('Cancel')).toBeInTheDocument();
    });

    it('should cancel delete when cancel clicked', async () => {
      render(<LabelManager walletId={walletId} />);

      await waitFor(() => {
        expect(screen.getByText('Exchange')).toBeInTheDocument();
      });

      const deleteButtons = screen.getAllByTitle('Delete label');
      fireEvent.click(deleteButtons[0]);

      const cancelButton = screen.getByTitle('Cancel');
      fireEvent.click(cancelButton);

      // Delete button should be visible again
      expect(screen.getAllByTitle('Delete label').length).toBeGreaterThan(0);
    });

    it('should delete label when confirmed', async () => {
      mockDeleteMutateAsync.mockResolvedValue(undefined);

      render(<LabelManager walletId={walletId} onLabelsChange={mockOnLabelsChange} />);

      await waitFor(() => {
        expect(screen.getByText('Exchange')).toBeInTheDocument();
      });

      const deleteButtons = screen.getAllByTitle('Delete label');
      fireEvent.click(deleteButtons[0]);

      const confirmButton = screen.getByTitle('Confirm delete');
      fireEvent.click(confirmButton);

      await waitFor(() => {
        expect(mockDeleteMutateAsync).toHaveBeenCalledWith({
          walletId,
          labelId: 'label-1',
        });
      });

      expect(mockOnLabelsChange).toHaveBeenCalled();
    });

    it('should show error on delete failure', async () => {
      const deleteError = new Error('Cannot delete');
      mockDeleteMutateAsync.mockRejectedValue(deleteError);

      render(<LabelManager walletId={walletId} />);

      await waitFor(() => {
        expect(screen.getByText('Exchange')).toBeInTheDocument();
      });

      const deleteButtons = screen.getAllByTitle('Delete label');
      fireEvent.click(deleteButtons[0]);

      const confirmButton = screen.getByTitle('Confirm delete');
      fireEvent.click(confirmButton);

      // After the mutation rejects, the component catches and the error stays
      // on the mutation object. We need to simulate the mutation error state.
      await waitFor(() => {
        expect(mockDeleteMutateAsync).toHaveBeenCalled();
      });

      // Re-render with the delete mutation in error state
      mockDeleteMutationReturn = { ...mockDeleteMutationReturn, error: deleteError };

      // Force a re-render by triggering state update — the component
      // should now read the error from the mutation hook.
      // Since the component catches the error, we simulate by re-rendering.
      const { unmount } = render(<LabelManager walletId={walletId} />);

      await waitFor(() => {
        expect(screen.getByText('Cannot delete')).toBeInTheDocument();
      });

      unmount();
    });
  });

  describe('color selection', () => {
    it('should change selected color', async () => {
      render(<LabelManager walletId={walletId} />);

      await waitFor(() => {
        expect(screen.getByText('New Label')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText('New Label'));

      // Find color buttons by their background color
      const colorButtons = screen.getAllByRole('button').filter(
        (btn) => btn.style.backgroundColor
      );

      // Click the green color (#22c55e)
      const greenButton = colorButtons.find(
        (btn) => btn.style.backgroundColor === 'rgb(34, 197, 94)'
      );

      if (greenButton) {
        fireEvent.click(greenButton);
        // The selected color should have ring class
        expect(greenButton).toHaveClass('ring-2');
      }
    });
  });

  describe('form validation', () => {
    it('should not save with empty name', async () => {
      render(<LabelManager walletId={walletId} />);

      await waitFor(() => {
        expect(screen.getByText('New Label')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText('New Label'));

      // Enter whitespace-only name
      const nameInput = screen.getByPlaceholderText('e.g., Exchange, Donation, Business');
      fireEvent.change(nameInput, { target: { value: '   ' } });

      const createButton = screen.getByText('Create Label');
      expect(createButton).toBeDisabled();
    });

    it('should trim whitespace from name and description', async () => {
      mockCreateMutateAsync.mockResolvedValue({
        id: 'new-label',
        walletId,
        name: 'Trimmed',
        color: '#6366f1',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      render(<LabelManager walletId={walletId} />);

      await waitFor(() => {
        expect(screen.getByText('New Label')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText('New Label'));

      const nameInput = screen.getByPlaceholderText('e.g., Exchange, Donation, Business');
      fireEvent.change(nameInput, { target: { value: '  Trimmed  ' } });

      const descInput = screen.getByPlaceholderText('Optional description for this label');
      fireEvent.change(descInput, { target: { value: '  A description  ' } });

      fireEvent.click(screen.getByText('Create Label'));

      await waitFor(() => {
        expect(mockCreateMutateAsync).toHaveBeenCalledWith({
          walletId,
          data: {
            name: 'Trimmed',
            color: '#6366f1',
            description: 'A description',
          },
        });
      });
    });

    it('should keep the form open when save fails and avoid onLabelsChange', async () => {
      mockCreateMutateAsync.mockRejectedValue(new Error('Save failed'));

      render(<LabelManager walletId={walletId} onLabelsChange={mockOnLabelsChange} />);

      await waitFor(() => {
        expect(screen.getByText('New Label')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText('New Label'));

      const nameInput = screen.getByPlaceholderText('e.g., Exchange, Donation, Business');
      fireEvent.change(nameInput, { target: { value: 'Failed Label' } });

      fireEvent.click(screen.getByText('Create Label'));

      await waitFor(() => {
        expect(mockCreateMutateAsync).toHaveBeenCalled();
      });

      // The form should remain open
      expect(screen.getByText('Create New Label')).toBeInTheDocument();
      expect(mockOnLabelsChange).not.toHaveBeenCalled();
    });
  });

  describe('saving state', () => {
    it('should show spinner instead of check icon while saving', async () => {
      mockCreateMutationReturn = { ...mockCreateMutationReturn, isPending: true };

      render(<LabelManager walletId={walletId} />);

      await waitFor(() => {
        expect(screen.getByText('New Label')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText('New Label'));

      const nameInput = screen.getByPlaceholderText('e.g., Exchange, Donation, Business');
      fireEvent.change(nameInput, { target: { value: 'Test' } });

      // The save button area should contain a spinner, not a check icon
      const saveButton = screen.getByText('Create Label').closest('button')!;
      expect(saveButton.querySelector('.animate-spin')).not.toBeNull();
    });
  });

  describe('wallet change', () => {
    it('should use the new walletId when component re-renders', async () => {
      // useWalletLabels is called with the walletId prop — React Query handles
      // automatic re-fetching when the key changes. We verify the hook is
      // set up to receive the walletId by checking the component renders
      // correctly with different walletIds.
      const { rerender } = render(<LabelManager walletId="wallet-1" />);

      await waitFor(() => {
        expect(screen.getByText('Exchange')).toBeInTheDocument();
      });

      rerender(<LabelManager walletId="wallet-2" />);

      await waitFor(() => {
        expect(screen.getByText('Exchange')).toBeInTheDocument();
      });
    });

    it('should close and clear an open create draft when the wallet changes', async () => {
      const { rerender } = render(<LabelManager walletId="wallet-1" />);

      await waitFor(() => {
        expect(screen.getByText('New Label')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText('New Label'));
      expect(screen.getByText('Create New Label')).toBeInTheDocument();

      const nameInput = screen.getByPlaceholderText('e.g., Exchange, Donation, Business');
      fireEvent.change(nameInput, { target: { value: 'Draft for wallet 1' } });

      rerender(<LabelManager walletId="wallet-2" />);

      expect(screen.queryByDisplayValue('Draft for wallet 1')).not.toBeInTheDocument();
      expect(screen.queryByText('Create New Label')).not.toBeInTheDocument();
    });

    it('should close an open edit draft when the wallet changes', async () => {
      const { rerender } = render(<LabelManager walletId="wallet-1" />);

      await waitFor(() => {
        expect(screen.getByText('Exchange')).toBeInTheDocument();
      });

      const editButtons = screen.getAllByTitle('Edit label');
      fireEvent.click(editButtons[0]);
      expect(screen.getByText('Edit Label')).toBeInTheDocument();

      rerender(<LabelManager walletId="wallet-2" />);

      expect(screen.queryByText('Edit Label')).not.toBeInTheDocument();
      expect(screen.queryByDisplayValue('Exchange')).not.toBeInTheDocument();
    });

    it('should close an open delete confirmation when the wallet changes', async () => {
      const { rerender } = render(<LabelManager walletId="wallet-1" />);

      await waitFor(() => {
        expect(screen.getByText('Exchange')).toBeInTheDocument();
      });

      const deleteButtons = screen.getAllByTitle('Delete label');
      fireEvent.click(deleteButtons[0]);
      expect(screen.getByTitle('Confirm delete')).toBeInTheDocument();

      rerender(<LabelManager walletId="wallet-2" />);

      expect(screen.queryByTitle('Confirm delete')).not.toBeInTheDocument();
    });

    it('should reset mutation error state exactly once when the wallet changes', async () => {
      const { rerender } = render(<LabelManager walletId="wallet-1" />);

      await waitFor(() => {
        expect(screen.getByText('Exchange')).toBeInTheDocument();
      });

      const createResetCallsBefore = mockCreateReset.mock.calls.length;
      const updateResetCallsBefore = mockUpdateReset.mock.calls.length;
      const deleteResetCallsBefore = mockDeleteReset.mock.calls.length;

      rerender(<LabelManager walletId="wallet-2" />);

      await waitFor(() => {
        expect(mockCreateReset.mock.calls.length).toBe(createResetCallsBefore + 1);
      });
      expect(mockUpdateReset.mock.calls.length).toBe(updateResetCallsBefore + 1);
      expect(mockDeleteReset.mock.calls.length).toBe(deleteResetCallsBefore + 1);

      // An unchanged rerender must not call reset again.
      rerender(<LabelManager walletId="wallet-2" />);
      expect(mockCreateReset.mock.calls.length).toBe(createResetCallsBefore + 1);
      expect(mockUpdateReset.mock.calls.length).toBe(updateResetCallsBefore + 1);
      expect(mockDeleteReset.mock.calls.length).toBe(deleteResetCallsBefore + 1);
    });

    it('should not reset mutation state on mount, even under StrictMode effect replay', async () => {
      const { rerender } = render(
        <StrictMode>
          <LabelManager walletId="wallet-1" />
        </StrictMode>
      );

      await waitFor(() => {
        expect(screen.getByText('Exchange')).toBeInTheDocument();
      });

      expect(mockCreateReset).not.toHaveBeenCalled();
      expect(mockUpdateReset).not.toHaveBeenCalled();
      expect(mockDeleteReset).not.toHaveBeenCalled();

      rerender(
        <StrictMode>
          <LabelManager walletId="wallet-2" />
        </StrictMode>
      );

      await waitFor(() => {
        expect(mockCreateReset).toHaveBeenCalledTimes(1);
      });
      expect(mockUpdateReset).toHaveBeenCalledTimes(1);
      expect(mockDeleteReset).toHaveBeenCalledTimes(1);
    });

    it('should discard a save that fails after the wallet changed instead of showing its error', async () => {
      let rejectSave: (error: Error) => void = () => {};
      mockCreateMutateAsync.mockImplementation(
        () => new Promise((_, reject) => { rejectSave = reject; })
      );
      const { rerender } = render(
        <LabelManager walletId="wallet-1" onLabelsChange={mockOnLabelsChange} />
      );

      await waitFor(() => {
        expect(screen.getByText('New Label')).toBeInTheDocument();
      });
      fireEvent.click(screen.getByText('New Label'));
      fireEvent.change(screen.getByPlaceholderText('e.g., Exchange, Donation, Business'), {
        target: { value: 'Stale draft' },
      });
      fireEvent.click(screen.getByText('Create Label'));
      expect(mockCreateMutateAsync).toHaveBeenCalledWith({
        walletId: 'wallet-1',
        data: { name: 'Stale draft', color: expect.any(String), description: undefined },
      });
      const resetCallsBeforeSwitch = mockCreateReset.mock.calls.length;

      rerender(<LabelManager walletId="wallet-2" onLabelsChange={mockOnLabelsChange} />);
      await waitFor(() => {
        expect(mockCreateReset).toHaveBeenCalledTimes(resetCallsBeforeSwitch + 1);
      });

      rejectSave(new Error('Save failed'));

      // The stale failure clears the mutation error again and never refreshes wallet 2.
      await waitFor(() => {
        expect(mockCreateReset).toHaveBeenCalledTimes(resetCallsBeforeSwitch + 2);
      });
      expect(mockOnLabelsChange).not.toHaveBeenCalled();
    });

    it('should not refresh the new wallet when a save issued for the previous wallet succeeds', async () => {
      let resolveSave: (value: unknown) => void = () => {};
      mockCreateMutateAsync.mockImplementation(
        () => new Promise((resolve) => { resolveSave = resolve; })
      );
      const { rerender } = render(
        <LabelManager walletId="wallet-1" onLabelsChange={mockOnLabelsChange} />
      );

      await waitFor(() => {
        expect(screen.getByText('New Label')).toBeInTheDocument();
      });
      fireEvent.click(screen.getByText('New Label'));
      fireEvent.change(screen.getByPlaceholderText('e.g., Exchange, Donation, Business'), {
        target: { value: 'Stale draft' },
      });
      fireEvent.click(screen.getByText('Create Label'));
      const resetCallsBeforeSwitch = mockCreateReset.mock.calls.length;

      rerender(<LabelManager walletId="wallet-2" onLabelsChange={mockOnLabelsChange} />);
      await waitFor(() => {
        expect(mockCreateReset).toHaveBeenCalledTimes(resetCallsBeforeSwitch + 1);
      });

      resolveSave({ id: 'label-new' });

      await waitFor(() => {
        expect(mockCreateReset).toHaveBeenCalledTimes(resetCallsBeforeSwitch + 2);
      });
      expect(mockOnLabelsChange).not.toHaveBeenCalled();
    });

    it('should not reset a newer in-flight save for the new wallet when the previous wallet save settles', async () => {
      const pending: Array<{ reject: (error: Error) => void }> = [];
      mockCreateMutateAsync.mockImplementation(
        () => new Promise((_, reject) => { pending.push({ reject }); })
      );
      const { rerender } = render(
        <LabelManager walletId="wallet-1" onLabelsChange={mockOnLabelsChange} />
      );

      await waitFor(() => {
        expect(screen.getByText('New Label')).toBeInTheDocument();
      });
      // Save on wallet 1 (stays in flight).
      fireEvent.click(screen.getByText('New Label'));
      fireEvent.change(screen.getByPlaceholderText('e.g., Exchange, Donation, Business'), {
        target: { value: 'Wallet 1 label' },
      });
      fireEvent.click(screen.getByText('Create Label'));

      rerender(<LabelManager walletId="wallet-2" onLabelsChange={mockOnLabelsChange} />);
      await waitFor(() => {
        expect(screen.getByText('New Label')).toBeInTheDocument();
      });
      // Save on wallet 2 while wallet 1's save is still in flight.
      fireEvent.click(screen.getByText('New Label'));
      fireEvent.change(screen.getByPlaceholderText('e.g., Exchange, Donation, Business'), {
        target: { value: 'Wallet 2 label' },
      });
      fireEvent.click(screen.getByText('Create Label'));
      expect(pending).toHaveLength(2);
      const resetsBeforeStaleSettle = mockCreateReset.mock.calls.length;

      // Wallet 1's save fails late: it must not reset the shared mutation
      // (that would detach wallet 2's in-flight save).
      pending[0].reject(new Error('Wallet 1 save failed'));
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(mockCreateReset.mock.calls.length).toBe(resetsBeforeStaleSettle);
      expect(mockOnLabelsChange).not.toHaveBeenCalled();

      // Wallet 2's own failure still surfaces through the hook state path.
      pending[1].reject(new Error('Wallet 2 save failed'));
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(mockCreateReset.mock.calls.length).toBe(resetsBeforeStaleSettle);
      expect(screen.getByDisplayValue('Wallet 2 label')).toBeInTheDocument();
    });

    it('should still reset a stale edit when only a different kind of mutation is in flight for the new wallet', async () => {
      let rejectUpdate: (error: Error) => void = () => {};
      mockUpdateMutateAsync.mockImplementation(
        () => new Promise((_, reject) => { rejectUpdate = reject; })
      );
      mockCreateMutateAsync.mockImplementation(() => new Promise(() => {}));
      const { rerender } = render(
        <LabelManager walletId="wallet-1" onLabelsChange={mockOnLabelsChange} />
      );

      await waitFor(() => {
        expect(screen.getByText('Exchange')).toBeInTheDocument();
      });
      // Edit on wallet 1 (stays in flight).
      fireEvent.click(screen.getAllByTitle('Edit label')[0]);
      fireEvent.click(screen.getByText('Save Changes'));

      rerender(<LabelManager walletId="wallet-2" onLabelsChange={mockOnLabelsChange} />);
      await waitFor(() => {
        expect(screen.getByText('New Label')).toBeInTheDocument();
      });
      // A create (different kind) is in flight for wallet 2.
      fireEvent.click(screen.getByText('New Label'));
      fireEvent.change(screen.getByPlaceholderText('e.g., Exchange, Donation, Business'), {
        target: { value: 'Wallet 2 label' },
      });
      fireEvent.click(screen.getByText('Create Label'));
      const updateResetsBefore = mockUpdateReset.mock.calls.length;
      const createResetsBefore = mockCreateReset.mock.calls.length;

      rejectUpdate(new Error('Wallet 1 update failed'));

      // The update kind has no newer issue, so its stale error is reset;
      // the in-flight create for wallet 2 is left untouched.
      await waitFor(() => {
        expect(mockUpdateReset.mock.calls.length).toBe(updateResetsBefore + 1);
      });
      expect(mockCreateReset.mock.calls.length).toBe(createResetsBefore);
      expect(mockOnLabelsChange).not.toHaveBeenCalled();
    });

    it('should discard an edit that fails after the wallet changed and reset only that mutation', async () => {
      let rejectUpdate: (error: Error) => void = () => {};
      mockUpdateMutateAsync.mockImplementation(
        () => new Promise((_, reject) => { rejectUpdate = reject; })
      );
      const { rerender } = render(
        <LabelManager walletId="wallet-1" onLabelsChange={mockOnLabelsChange} />
      );

      await waitFor(() => {
        expect(screen.getByText('Exchange')).toBeInTheDocument();
      });
      fireEvent.click(screen.getAllByTitle('Edit label')[0]);
      fireEvent.click(screen.getByText('Save Changes'));
      expect(mockUpdateMutateAsync).toHaveBeenCalledWith({
        walletId: 'wallet-1',
        labelId: 'label-1',
        data: { name: 'Exchange', color: '#6366f1', description: 'Exchange deposits' },
      });
      const updateResetsBeforeSwitch = mockUpdateReset.mock.calls.length;
      const createResetsBeforeSwitch = mockCreateReset.mock.calls.length;
      const deleteResetsBeforeSwitch = mockDeleteReset.mock.calls.length;

      rerender(<LabelManager walletId="wallet-2" onLabelsChange={mockOnLabelsChange} />);
      await waitFor(() => {
        expect(mockUpdateReset).toHaveBeenCalledTimes(updateResetsBeforeSwitch + 1);
      });

      rejectUpdate(new Error('Update failed'));

      // Only the update mutation is reset by the stale settle; create/delete
      // (possibly already in flight for wallet 2) are left alone.
      await waitFor(() => {
        expect(mockUpdateReset).toHaveBeenCalledTimes(updateResetsBeforeSwitch + 2);
      });
      expect(mockCreateReset).toHaveBeenCalledTimes(createResetsBeforeSwitch + 1);
      expect(mockDeleteReset).toHaveBeenCalledTimes(deleteResetsBeforeSwitch + 1);
      expect(mockOnLabelsChange).not.toHaveBeenCalled();
    });

    it('should not refresh the new wallet when a delete issued for the previous wallet succeeds', async () => {
      let resolveDelete: (value: unknown) => void = () => {};
      mockDeleteMutateAsync.mockImplementation(
        () => new Promise((resolve) => { resolveDelete = resolve; })
      );
      const { rerender } = render(
        <LabelManager walletId="wallet-1" onLabelsChange={mockOnLabelsChange} />
      );

      await waitFor(() => {
        expect(screen.getByText('Exchange')).toBeInTheDocument();
      });
      fireEvent.click(screen.getAllByTitle('Delete label')[0]);
      fireEvent.click(screen.getByTitle('Confirm delete'));

      rerender(<LabelManager walletId="wallet-2" onLabelsChange={mockOnLabelsChange} />);
      await waitFor(() => {
        expect(mockDeleteReset).toHaveBeenCalledTimes(1);
      });

      resolveDelete(undefined);

      await waitFor(() => {
        expect(mockDeleteReset).toHaveBeenCalledTimes(2);
      });
      expect(mockOnLabelsChange).not.toHaveBeenCalled();
    });

    it('should discard a delete that fails after the wallet changed', async () => {
      let rejectDelete: (error: Error) => void = () => {};
      mockDeleteMutateAsync.mockImplementation(
        () => new Promise((_, reject) => { rejectDelete = reject; })
      );
      const { rerender } = render(
        <LabelManager walletId="wallet-1" onLabelsChange={mockOnLabelsChange} />
      );

      await waitFor(() => {
        expect(screen.getByText('Exchange')).toBeInTheDocument();
      });
      fireEvent.click(screen.getAllByTitle('Delete label')[0]);
      fireEvent.click(screen.getByTitle('Confirm delete'));
      expect(mockDeleteMutateAsync).toHaveBeenCalledWith({ walletId: 'wallet-1', labelId: 'label-1' });

      rerender(<LabelManager walletId="wallet-2" onLabelsChange={mockOnLabelsChange} />);
      await waitFor(() => {
        expect(mockDeleteReset).toHaveBeenCalledTimes(1);
      });

      rejectDelete(new Error('Delete failed'));

      await waitFor(() => {
        expect(mockDeleteReset).toHaveBeenCalledTimes(2);
      });
      expect(mockOnLabelsChange).not.toHaveBeenCalled();
    });
  });
});
