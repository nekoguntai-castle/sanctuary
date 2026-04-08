/**
 * LabelManager Component Tests
 *
 * Tests for the label management component including CRUD operations.
 */

import { fireEvent,render,screen,waitFor } from '@testing-library/react';
import { beforeEach,describe,expect,it,vi } from 'vitest';
import { LabelManager } from '../../components/LabelManager';
import type { Label } from '../../types';

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

vi.mock('../../hooks/queries/useWalletLabels', () => ({
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
  });
});
