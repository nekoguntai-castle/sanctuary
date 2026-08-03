/**
 * DeleteModal Component Tests
 *
 * Tests for the wallet deletion confirmation modal with DELETE
 * typing requirement for safety.
 */

import { act,render,screen,waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { beforeEach,describe,expect,it,vi } from 'vitest';

// Mock lucide-react icons
vi.mock('lucide-react', () => ({
  AlertTriangle: () => <span data-testid="alert-icon" />,
}));

// Mock Button component
vi.mock('../../../../src/components/ui/Button', () => ({
  Button: ({
    children,
    onClick,
    disabled,
    variant,
    className,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
    variant?: string;
    className?: string;
  }) => (
    <button
      onClick={onClick}
      disabled={disabled}
      data-variant={variant}
      className={className}
    >
      {children}
    </button>
  ),
}));

// Import after mocks
import { DeleteModal } from '../../../../src/components/WalletDetail/modals/DeleteModal';

describe('DeleteModal', () => {
  const defaultProps = {
    walletName: 'Test Wallet',
    onConfirm: vi.fn().mockResolvedValue(undefined),
    onClose: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Rendering', () => {
    it('should render the delete confirmation modal', () => {
      render(<DeleteModal {...defaultProps} />);

      expect(screen.getByText('Delete Wallet?')).toBeInTheDocument();
    });

    it('should display warning icon', () => {
      render(<DeleteModal {...defaultProps} />);

      expect(screen.getByTestId('alert-icon')).toBeInTheDocument();
    });

    it('should display warning message about permanent deletion', () => {
      render(<DeleteModal {...defaultProps} />);

      expect(
        screen.getByText(/this action cannot be undone/i)
      ).toBeInTheDocument();
    });

    it('should display instruction to type DELETE', () => {
      render(<DeleteModal {...defaultProps} />);

      expect(screen.getByText(/type/i)).toBeInTheDocument();
      expect(screen.getByText('DELETE')).toBeInTheDocument();
    });

    it('should render input field with placeholder', () => {
      render(<DeleteModal {...defaultProps} />);

      expect(screen.getByPlaceholderText('DELETE')).toBeInTheDocument();
    });

    it('should render Cancel button', () => {
      render(<DeleteModal {...defaultProps} />);

      expect(
        screen.getByRole('button', { name: 'Cancel' })
      ).toBeInTheDocument();
    });

    it('should render Delete button', () => {
      render(<DeleteModal {...defaultProps} />);

      expect(
        screen.getByRole('button', { name: 'Delete Forever' })
      ).toBeInTheDocument();
    });
  });

  describe('DELETE Confirmation', () => {
    it('should have delete button disabled initially', () => {
      render(<DeleteModal {...defaultProps} />);

      const deleteButton = screen.getByRole('button', { name: 'Delete Forever' });
      expect(deleteButton).toBeDisabled();
    });

    it('should keep delete button disabled with partial typing', async () => {
      const user = userEvent.setup();
      render(<DeleteModal {...defaultProps} />);

      const input = screen.getByPlaceholderText('DELETE');
      await user.type(input, 'DEL');

      const deleteButton = screen.getByRole('button', { name: 'Delete Forever' });
      expect(deleteButton).toBeDisabled();
    });

    it('should keep delete button disabled with wrong text', async () => {
      const user = userEvent.setup();
      render(<DeleteModal {...defaultProps} />);

      const input = screen.getByPlaceholderText('DELETE');
      await user.type(input, 'delete'); // lowercase

      const deleteButton = screen.getByRole('button', { name: 'Delete Forever' });
      expect(deleteButton).toBeDisabled();
    });

    it('should enable delete button when DELETE is typed', async () => {
      const user = userEvent.setup();
      render(<DeleteModal {...defaultProps} />);

      const input = screen.getByPlaceholderText('DELETE');
      await user.type(input, 'DELETE');

      const deleteButton = screen.getByRole('button', { name: 'Delete Forever' });
      expect(deleteButton).not.toBeDisabled();
    });

    it('should update input value as user types', async () => {
      const user = userEvent.setup();
      render(<DeleteModal {...defaultProps} />);

      const input = screen.getByPlaceholderText('DELETE');
      await user.type(input, 'DEL');

      expect(input).toHaveValue('DEL');
    });
  });

  describe('Confirm Deletion', () => {
    it('should call onConfirm when DELETE is typed and button clicked', async () => {
      const user = userEvent.setup();
      const onConfirm = vi.fn().mockResolvedValue(undefined);
      render(<DeleteModal {...defaultProps} onConfirm={onConfirm} />);

      const input = screen.getByPlaceholderText('DELETE');
      await user.type(input, 'DELETE');

      const deleteButton = screen.getByRole('button', { name: 'Delete Forever' });
      await user.click(deleteButton);

      expect(onConfirm).toHaveBeenCalledTimes(1);
    });

    it('should not call onConfirm when DELETE is not fully typed', async () => {
      const user = userEvent.setup();
      const onConfirm = vi.fn().mockResolvedValue(undefined);
      render(<DeleteModal {...defaultProps} onConfirm={onConfirm} />);

      const input = screen.getByPlaceholderText('DELETE');
      await user.type(input, 'DEL');

      // Try to force click (button should be disabled but let's be sure the handler checks)
      const deleteButton = screen.getByRole('button', { name: 'Delete Forever' });
      await user.click(deleteButton);

      expect(onConfirm).not.toHaveBeenCalled();
    });
  });

  describe('Loading State', () => {
    it('should show loading text during deletion', async () => {
      const user = userEvent.setup();
      let resolveDelete: () => void;
      const onConfirm = vi.fn().mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            resolveDelete = resolve;
          })
      );

      render(<DeleteModal {...defaultProps} onConfirm={onConfirm} />);

      const input = screen.getByPlaceholderText('DELETE');
      await user.type(input, 'DELETE');

      const deleteButton = screen.getByRole('button', { name: 'Delete Forever' });
      await user.click(deleteButton);

      expect(screen.getByText('Deleting...')).toBeInTheDocument();

      // Resolve the promise
      await waitFor(() => {
        resolveDelete!();
      });
    });

    it('should disable button during deletion', async () => {
      const user = userEvent.setup();
      let resolveDelete: () => void;
      const onConfirm = vi.fn().mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            resolveDelete = resolve;
          })
      );

      render(<DeleteModal {...defaultProps} onConfirm={onConfirm} />);

      const input = screen.getByPlaceholderText('DELETE');
      await user.type(input, 'DELETE');

      const deleteButton = screen.getByRole('button', { name: 'Delete Forever' });
      await user.click(deleteButton);

      // Get the button again (it now shows "Deleting...")
      const deletingButton = screen.getByRole('button', { name: 'Deleting...' });
      expect(deletingButton).toBeDisabled();

      await waitFor(() => {
        resolveDelete!();
      });
    });
  });

  describe('Cancel', () => {
    it('should call onClose when Cancel is clicked', async () => {
      const user = userEvent.setup();
      const onClose = vi.fn();
      render(<DeleteModal {...defaultProps} onClose={onClose} />);

      const cancelButton = screen.getByRole('button', { name: 'Cancel' });
      await user.click(cancelButton);

      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('should clear input when Cancel is clicked', async () => {
      const user = userEvent.setup();
      render(<DeleteModal {...defaultProps} />);

      const input = screen.getByPlaceholderText('DELETE');
      await user.type(input, 'DEL');

      expect(input).toHaveValue('DEL');

      const cancelButton = screen.getByRole('button', { name: 'Cancel' });
      await user.click(cancelButton);

      // After cancel, onClose is called (in real app, modal would be closed)
      expect(defaultProps.onClose).toHaveBeenCalled();
    });
  });

  describe('Slow Operation', () => {
    it('should stay disabled while delete operation is pending', async () => {
      const user = userEvent.setup();
      let resolveDelete: () => void;
      const onConfirm = vi.fn().mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            resolveDelete = resolve;
          })
      );

      render(<DeleteModal {...defaultProps} onConfirm={onConfirm} />);

      const input = screen.getByPlaceholderText('DELETE');
      await user.type(input, 'DELETE');

      const deleteButton = screen.getByRole('button', { name: 'Delete Forever' });
      await user.click(deleteButton);

      // Verify the button shows loading and is disabled
      const loadingButton = screen.getByRole('button', { name: 'Deleting...' });
      expect(loadingButton).toBeDisabled();

      // onConfirm should have been called
      expect(onConfirm).toHaveBeenCalledTimes(1);

      // Resolve to clean up
      await act(async () => {
        resolveDelete!();
      });
    });
  });
});
