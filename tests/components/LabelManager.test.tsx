/**
 * LabelManager Component Tests
 *
 * Tests for the label management component including CRUD operations.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { LabelManager } from '../../components/LabelManager';
import type { Label } from '../../src/api/labels';

// Mock the labels API
const mockGetLabels = vi.fn();
const mockCreateLabel = vi.fn();
const mockUpdateLabel = vi.fn();
const mockDeleteLabel = vi.fn();

vi.mock('../../src/api/labels', () => ({
  getLabels: (...args: any[]) => mockGetLabels(...args),
  createLabel: (...args: any[]) => mockCreateLabel(...args),
  updateLabel: (...args: any[]) => mockUpdateLabel(...args),
  deleteLabel: (...args: any[]) => mockDeleteLabel(...args),
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
    mockGetLabels.mockResolvedValue(mockLabels);
  });

  describe('loading state', () => {
    it('should show loading spinner initially', () => {
      mockGetLabels.mockImplementation(() => new Promise(() => {})); // Never resolves

      const { container } = render(<LabelManager walletId={walletId} />);

      // Check for the spinner element
      const spinner = container.querySelector('.animate-spin');
      expect(spinner).toBeTruthy();
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
      mockGetLabels.mockResolvedValue([]);

      render(<LabelManager walletId={walletId} />);

      await waitFor(() => {
        expect(screen.getByText('No labels created yet.')).toBeInTheDocument();
        expect(screen.getByText('Create labels to organize your transactions and addresses.')).toBeInTheDocument();
      });
    });
  });

  describe('error handling', () => {
    it('should show error message on load failure', async () => {
      mockGetLabels.mockRejectedValue(new Error('Network error'));

      render(<LabelManager walletId={walletId} />);

      await waitFor(() => {
        expect(screen.getByText('Network error')).toBeInTheDocument();
      });
    });

    it('should show default error message', async () => {
      mockGetLabels.mockRejectedValue({});

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
      mockCreateLabel.mockResolvedValue({
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
        expect(mockCreateLabel).toHaveBeenCalledWith(walletId, {
          name: 'New Label',
          color: '#6366f1',
          description: undefined,
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
      mockUpdateLabel.mockResolvedValue({
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
        expect(mockUpdateLabel).toHaveBeenCalledWith(walletId, 'label-1', {
          name: 'Updated Exchange',
          color: '#6366f1',
          description: 'Exchange deposits',
        });
      });

      expect(mockOnLabelsChange).toHaveBeenCalled();
    });

    it('should send undefined description when edit description is whitespace', async () => {
      mockUpdateLabel.mockResolvedValue({
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
        expect(mockUpdateLabel).toHaveBeenCalledWith(walletId, 'label-1', {
          name: 'Exchange',
          color: '#6366f1',
          description: undefined,
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
      mockDeleteLabel.mockResolvedValue(undefined);

      render(<LabelManager walletId={walletId} onLabelsChange={mockOnLabelsChange} />);

      await waitFor(() => {
        expect(screen.getByText('Exchange')).toBeInTheDocument();
      });

      const deleteButtons = screen.getAllByTitle('Delete label');
      fireEvent.click(deleteButtons[0]);

      const confirmButton = screen.getByTitle('Confirm delete');
      fireEvent.click(confirmButton);

      await waitFor(() => {
        expect(mockDeleteLabel).toHaveBeenCalledWith(walletId, 'label-1');
      });

      expect(mockOnLabelsChange).toHaveBeenCalled();
    });

    it('should show error on delete failure', async () => {
      mockDeleteLabel.mockRejectedValue(new Error('Cannot delete'));

      render(<LabelManager walletId={walletId} />);

      await waitFor(() => {
        expect(screen.getByText('Exchange')).toBeInTheDocument();
      });

      const deleteButtons = screen.getAllByTitle('Delete label');
      fireEvent.click(deleteButtons[0]);

      const confirmButton = screen.getByTitle('Confirm delete');
      fireEvent.click(confirmButton);

      await waitFor(() => {
        expect(screen.getByText('Cannot delete')).toBeInTheDocument();
      });
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
      mockCreateLabel.mockResolvedValue({
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
        expect(mockCreateLabel).toHaveBeenCalledWith(walletId, {
          name: 'Trimmed',
          color: '#6366f1',
          description: 'A description',
        });
      });
    });

    it('should keep the form open when save fails and avoid onLabelsChange', async () => {
      mockCreateLabel.mockRejectedValue(new Error('Save failed'));

      render(<LabelManager walletId={walletId} onLabelsChange={mockOnLabelsChange} />);

      await waitFor(() => {
        expect(screen.getByText('New Label')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText('New Label'));

      const nameInput = screen.getByPlaceholderText('e.g., Exchange, Donation, Business');
      fireEvent.change(nameInput, { target: { value: 'Failed Label' } });

      fireEvent.click(screen.getByText('Create Label'));

      await waitFor(() => {
        expect(screen.getByText('Save failed')).toBeInTheDocument();
      });

      expect(screen.getByText('Create New Label')).toBeInTheDocument();
      expect(mockOnLabelsChange).not.toHaveBeenCalled();
      expect(mockGetLabels).toHaveBeenCalledTimes(1);
    });
  });

  describe('wallet change', () => {
    it('should reload labels when walletId changes', async () => {
      const { rerender } = render(<LabelManager walletId="wallet-1" />);

      await waitFor(() => {
        expect(mockGetLabels).toHaveBeenCalledWith('wallet-1');
      });

      mockGetLabels.mockClear();

      rerender(<LabelManager walletId="wallet-2" />);

      await waitFor(() => {
        expect(mockGetLabels).toHaveBeenCalledWith('wallet-2');
      });
    });
  });
});
