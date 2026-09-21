/**
 * Tests for TransferOwnershipModal component
 */

import { act,fireEvent,render,renderHook,screen,waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { FormEvent } from 'react';
import { beforeEach,describe,expect,it,vi } from 'vitest';
import { TransferOwnershipModal } from '../../src/components/TransferOwnershipModal';
import * as authApi from '../../src/api/auth';
import { ApiError } from '../../src/api/client';
import * as transfersApi from '../../src/api/transfers';
import { useTransferOwnershipModal } from '../../src/components/TransferOwnershipModal/useTransferOwnershipModal';

vi.mock('../../src/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Mock APIs
vi.mock('../../src/api/auth', () => ({
  searchUsers: vi.fn(),
}));

vi.mock('../../src/api/transfers', () => ({
  initiateTransfer: vi.fn(),
}));

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe('TransferOwnershipModal', () => {
  const defaultProps = {
    resourceType: 'wallet' as const,
    resourceId: 'wallet-123',
    resourceName: 'My Savings',
    onClose: vi.fn(),
    onTransferInitiated: vi.fn(),
  };

  const mockSearchResults = [
    { id: 'user-1', username: 'alice' },
    { id: 'user-2', username: 'bob' },
    { id: 'user-3', username: 'charlie' },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(authApi.searchUsers).mockResolvedValue(mockSearchResults as any);
    vi.mocked(transfersApi.initiateTransfer).mockResolvedValue({} as any);
  });

  describe('rendering', () => {
    it('renders modal with title', () => {
      render(<TransferOwnershipModal {...defaultProps} />);

      expect(screen.getByText('Transfer Ownership')).toBeInTheDocument();
    });

    it('shows resource type and name', () => {
      render(<TransferOwnershipModal {...defaultProps} />);

      expect(screen.getByText(/Wallet: My Savings/)).toBeInTheDocument();
    });

    it('shows device label for device transfers', () => {
      render(<TransferOwnershipModal {...defaultProps} resourceType="device" resourceName="Ledger Nano" />);

      expect(screen.getByText(/Device: Ledger Nano/)).toBeInTheDocument();
    });

    it('shows warning about 3-step process', () => {
      render(<TransferOwnershipModal {...defaultProps} />);

      expect(screen.getByText('3-Step Transfer Process')).toBeInTheDocument();
      expect(screen.getByText(/You initiate the transfer/)).toBeInTheDocument();
      expect(screen.getByText(/Recipient accepts or declines/)).toBeInTheDocument();
      expect(screen.getByText(/You confirm to complete/)).toBeInTheDocument();
    });
  });

  describe('user search', () => {
    it('shows search input for new owner', () => {
      render(<TransferOwnershipModal {...defaultProps} />);

      expect(screen.getByPlaceholderText('Search users by username...')).toBeInTheDocument();
    });

    it('does not search for queries shorter than 2 characters', async () => {
      const user = userEvent.setup();
      render(<TransferOwnershipModal {...defaultProps} />);

      const input = screen.getByPlaceholderText('Search users by username...');
      await user.type(input, 'a');

      expect(authApi.searchUsers).not.toHaveBeenCalled();
    });

    it('searches when query is 2+ characters', async () => {
      const user = userEvent.setup();
      render(<TransferOwnershipModal {...defaultProps} />);

      const input = screen.getByPlaceholderText('Search users by username...');
      await user.type(input, 'al');

      await waitFor(() => {
        expect(authApi.searchUsers).toHaveBeenCalledWith('al');
      });
    });

    it('displays search results', async () => {
      const user = userEvent.setup();
      render(<TransferOwnershipModal {...defaultProps} />);

      const input = screen.getByPlaceholderText('Search users by username...');
      await user.type(input, 'alice');

      await waitFor(() => {
        expect(screen.getByText('alice')).toBeInTheDocument();
        expect(screen.getByText('bob')).toBeInTheDocument();
        expect(screen.getByText('charlie')).toBeInTheDocument();
      });
    });

    it('shows "No users found" when search returns empty', async () => {
      vi.mocked(authApi.searchUsers).mockResolvedValue([]);

      const user = userEvent.setup();
      render(<TransferOwnershipModal {...defaultProps} />);

      const input = screen.getByPlaceholderText('Search users by username...');
      await user.type(input, 'nonexistent');

      await waitFor(() => {
        expect(screen.getByText('No users found')).toBeInTheDocument();
      });
    });

    it('shows loading spinner while searching', async () => {
      vi.mocked(authApi.searchUsers).mockImplementation(
        () => new Promise<never>(() => undefined)
      );

      const user = userEvent.setup();
      render(<TransferOwnershipModal {...defaultProps} />);

      const input = screen.getByPlaceholderText('Search users by username...');
      await user.type(input, 'al'); // type only 2 chars to trigger search

      // The spinner appears while search is in progress
      await waitFor(() => {
        expect(document.querySelector('.animate-spin')).toBeInTheDocument();
      }, { timeout: 100 });
    });

    it('handles search API failures without crashing', async () => {
      vi.mocked(authApi.searchUsers).mockRejectedValueOnce(new Error('search failed'));

      const user = userEvent.setup();
      render(<TransferOwnershipModal {...defaultProps} />);

      const input = screen.getByPlaceholderText('Search users by username...');
      await user.type(input, 'al');

      await waitFor(() => {
        expect(authApi.searchUsers).toHaveBeenCalledWith('al');
      });
      expect(screen.queryByText('alice')).not.toBeInTheDocument();
    });

    it('keeps the latest results when searches resolve in reverse order', async () => {
      const first = createDeferred<authApi.SearchUser[]>();
      const second = createDeferred<authApi.SearchUser[]>();
      vi.mocked(authApi.searchUsers).mockImplementation((query) => (
        query === 'al' ? first.promise : second.promise
      ));
      render(<TransferOwnershipModal {...defaultProps} />);
      const input = screen.getByPlaceholderText('Search users by username...');

      fireEvent.change(input, { target: { value: 'al' } });
      fireEvent.change(input, { target: { value: 'alice' } });
      await act(async () => {
        second.resolve([{ id: 'latest', username: 'alice-current' }]);
        await second.promise;
      });
      expect(screen.getByText('alice-current')).toBeInTheDocument();

      await act(async () => {
        first.resolve([{ id: 'stale', username: 'al-stale' }]);
        await first.promise;
      });
      expect(screen.getByText('alice-current')).toBeInTheDocument();
      expect(screen.queryByText('al-stale')).not.toBeInTheDocument();
    });

    it('invalidates a pending search when the query becomes too short', async () => {
      const pending = createDeferred<authApi.SearchUser[]>();
      vi.mocked(authApi.searchUsers).mockReturnValue(pending.promise);
      render(<TransferOwnershipModal {...defaultProps} />);
      const input = screen.getByPlaceholderText('Search users by username...');

      fireEvent.change(input, { target: { value: 'al' } });
      expect(document.querySelector('.animate-spin')).toBeInTheDocument();
      fireEvent.change(input, { target: { value: 'a' } });
      expect(document.querySelector('.animate-spin')).not.toBeInTheDocument();

      await act(async () => {
        pending.resolve([{ id: 'stale', username: 'late-alice' }]);
        await pending.promise;
      });
      expect(screen.queryByText('late-alice')).not.toBeInTheDocument();
    });

    it('keeps the current spinner when a stale request settles', async () => {
      const first = createDeferred<authApi.SearchUser[]>();
      const second = createDeferred<authApi.SearchUser[]>();
      vi.mocked(authApi.searchUsers)
        .mockReturnValueOnce(first.promise)
        .mockReturnValueOnce(second.promise);
      render(<TransferOwnershipModal {...defaultProps} />);
      const input = screen.getByPlaceholderText('Search users by username...');

      fireEvent.change(input, { target: { value: 'al' } });
      fireEvent.change(input, { target: { value: 'alice' } });
      await act(async () => {
        first.resolve([]);
        await first.promise;
      });
      expect(document.querySelector('.animate-spin')).toBeInTheDocument();

      await act(async () => {
        second.resolve([]);
        await second.promise;
      });
      expect(document.querySelector('.animate-spin')).not.toBeInTheDocument();
    });

    it('keeps the current spinner when a stale request rejects', async () => {
      const first = createDeferred<authApi.SearchUser[]>();
      const second = createDeferred<authApi.SearchUser[]>();
      vi.mocked(authApi.searchUsers)
        .mockReturnValueOnce(first.promise)
        .mockReturnValueOnce(second.promise);
      render(<TransferOwnershipModal {...defaultProps} />);
      const input = screen.getByPlaceholderText('Search users by username...');

      fireEvent.change(input, { target: { value: 'al' } });
      fireEvent.change(input, { target: { value: 'alice' } });
      await act(async () => {
        first.reject(new Error('stale failure'));
        await first.promise.catch(() => undefined);
      });
      expect(document.querySelector('.animate-spin')).toBeInTheDocument();

      await act(async () => {
        second.resolve([]);
        await second.promise;
      });
      expect(document.querySelector('.animate-spin')).not.toBeInTheDocument();
    });

    it('removes completed results while the next query is pending', async () => {
      const pending = createDeferred<authApi.SearchUser[]>();
      vi.mocked(authApi.searchUsers)
        .mockResolvedValueOnce([{ id: 'old', username: 'old-result' }])
        .mockReturnValueOnce(pending.promise);
      render(<TransferOwnershipModal {...defaultProps} />);
      const input = screen.getByPlaceholderText('Search users by username...');

      fireEvent.change(input, { target: { value: 'al' } });
      await waitFor(() => expect(screen.getByText('old-result')).toBeInTheDocument());
      fireEvent.change(input, { target: { value: 'bob' } });

      expect(screen.queryByText('old-result')).not.toBeInTheDocument();
      await act(async () => {
        pending.resolve([]);
        await pending.promise;
      });
    });
  });

  describe('user selection', () => {
    it('selects user when clicking search result', async () => {
      const user = userEvent.setup();
      render(<TransferOwnershipModal {...defaultProps} />);

      const input = screen.getByPlaceholderText('Search users by username...');
      await user.type(input, 'alice');

      await waitFor(() => {
        expect(screen.getByText('alice')).toBeInTheDocument();
      });

      await user.click(screen.getByText('alice'));

      await waitFor(() => {
        expect(screen.getByText('Will receive ownership')).toBeInTheDocument();
      });
    });

    it('shows selected user with avatar', async () => {
      const user = userEvent.setup();
      render(<TransferOwnershipModal {...defaultProps} />);

      const input = screen.getByPlaceholderText('Search users by username...');
      await user.type(input, 'alice');

      await waitFor(() => {
        expect(screen.getByText('alice')).toBeInTheDocument();
      });

      await user.click(screen.getByText('alice'));

      await waitFor(() => {
        // Avatar should show first letter
        expect(screen.getByText('A')).toBeInTheDocument();
      });
    });

    it('clears selection when clicking X', async () => {
      const user = userEvent.setup();
      render(<TransferOwnershipModal {...defaultProps} />);

      const input = screen.getByPlaceholderText('Search users by username...');
      await user.type(input, 'alice');

      await waitFor(() => {
        expect(screen.getByText('alice')).toBeInTheDocument();
      });

      await user.click(screen.getByText('alice'));

      await waitFor(() => {
        expect(screen.getByText('Will receive ownership')).toBeInTheDocument();
      });

      await user.click(screen.getByRole('button', { name: 'Clear selected recipient' }));

      await waitFor(() => {
        expect(screen.getByPlaceholderText('Search users by username...')).toBeInTheDocument();
      });
    });

    it('ignores an older search after selecting and clearing a current result', async () => {
      const stale = createDeferred<authApi.SearchUser[]>();
      vi.mocked(authApi.searchUsers)
        .mockReturnValueOnce(stale.promise)
        .mockResolvedValueOnce([{ id: 'current', username: 'current-user' }]);
      const user = userEvent.setup();
      render(<TransferOwnershipModal {...defaultProps} />);
      const input = screen.getByPlaceholderText('Search users by username...');

      fireEvent.change(input, { target: { value: 'al' } });
      fireEvent.change(input, { target: { value: 'alice' } });
      await waitFor(() => expect(screen.getByText('current-user')).toBeInTheDocument());
      await user.click(screen.getByText('current-user'));
      await user.click(screen.getByRole('button', { name: 'Clear selected recipient' }));

      await act(async () => {
        stale.resolve([{ id: 'stale', username: 'stale-user' }]);
        await stale.promise;
      });
      expect(screen.getByPlaceholderText('Search users by username...')).toHaveValue('');
      expect(screen.queryByText('stale-user')).not.toBeInTheDocument();
      expect(screen.queryByText('Will receive ownership')).not.toBeInTheDocument();
    });

    it('rejects a stale recipient ID but accepts the visible ID after rerender', async () => {
      const currentUser = { id: 'current', username: 'current-user' };
      vi.mocked(authApi.searchUsers).mockResolvedValueOnce([currentUser]);
      const { result, rerender } = renderHook(() => useTransferOwnershipModal({
        resourceType: defaultProps.resourceType,
        resourceId: defaultProps.resourceId,
        onTransferInitiated: defaultProps.onTransferInitiated,
      }));

      await act(async () => {
        await result.current.handleSearch('current');
      });
      act(() => {
        result.current.handleSelectUser({ id: 'stale', username: 'stale-user' });
      });
      expect(result.current.selectedUser).toBeNull();
      expect(result.current.searchResults).toEqual([currentUser]);

      await act(async () => {
        await result.current.handleSubmit({ preventDefault: vi.fn() } as unknown as FormEvent);
      });
      expect(transfersApi.initiateTransfer).not.toHaveBeenCalled();

      rerender();
      act(() => {
        result.current.handleSelectUser({ ...currentUser });
      });
      expect(result.current.selectedUser).toBe(currentUser);
    });
  });

  describe('message field', () => {
    it('shows optional message textarea', () => {
      render(<TransferOwnershipModal {...defaultProps} />);

      expect(screen.getByPlaceholderText('Add a note for the recipient...')).toBeInTheDocument();
    });

    it('shows character count', () => {
      render(<TransferOwnershipModal {...defaultProps} />);

      expect(screen.getByText('0/500 characters')).toBeInTheDocument();
    });

    it('updates character count when typing', async () => {
      const user = userEvent.setup();
      render(<TransferOwnershipModal {...defaultProps} />);

      const textarea = screen.getByPlaceholderText('Add a note for the recipient...');
      await user.type(textarea, 'Hello');

      expect(screen.getByText('5/500 characters')).toBeInTheDocument();
    });
  });

  describe('keep existing users option', () => {
    it('shows checkbox for keeping existing viewers', () => {
      render(<TransferOwnershipModal {...defaultProps} />);

      expect(screen.getByLabelText(/Keep existing viewers/)).toBeInTheDocument();
    });

    it('is checked by default', () => {
      render(<TransferOwnershipModal {...defaultProps} />);

      const checkbox = screen.getByLabelText(/Keep existing viewers/);
      expect(checkbox).toBeChecked();
    });

    it('shows explanatory text for checked state', () => {
      render(<TransferOwnershipModal {...defaultProps} />);

      expect(screen.getByText(/You will retain viewer access/)).toBeInTheDocument();
    });

    it('updates explanatory text when unchecked', async () => {
      const user = userEvent.setup();
      render(<TransferOwnershipModal {...defaultProps} />);

      const checkbox = screen.getByLabelText(/Keep existing viewers/);
      await user.click(checkbox);

      expect(screen.getByText(/All existing access.*will be removed/)).toBeInTheDocument();
    });
  });

  describe('form submission', () => {
    it('disables submit button when no user selected', () => {
      render(<TransferOwnershipModal {...defaultProps} />);

      const submitButton = screen.getByText('Initiate Transfer').closest('button');
      expect(submitButton).toBeDisabled();
    });

    it('shows recipient selection error when submit is forced without selected user', () => {
      render(<TransferOwnershipModal {...defaultProps} />);

      const form = screen.getByText('Initiate Transfer').closest('form');
      expect(form).toBeInTheDocument();
      fireEvent.submit(form!);

      expect(screen.getByText('Please select a recipient')).toBeInTheDocument();
    });

    it('initiates transfer with correct parameters', async () => {
      const user = userEvent.setup();
      render(<TransferOwnershipModal {...defaultProps} />);

      // Search and select user
      const input = screen.getByPlaceholderText('Search users by username...');
      await user.type(input, 'alice');

      await waitFor(() => {
        expect(screen.getByText('alice')).toBeInTheDocument();
      });

      await user.click(screen.getByText('alice'));

      // Add message
      const textarea = screen.getByPlaceholderText('Add a note for the recipient...');
      await user.type(textarea, 'Here you go!');

      // Submit
      const submitButton = screen.getByText('Initiate Transfer');
      await user.click(submitButton);

      await waitFor(() => {
        expect(transfersApi.initiateTransfer).toHaveBeenCalledWith({
          resourceType: 'wallet',
          resourceId: 'wallet-123',
          toUserId: 'user-1',
          message: 'Here you go!',
          keepExistingUsers: true,
        });
      });
    });

    it('calls onTransferInitiated on success', async () => {
      const user = userEvent.setup();
      render(<TransferOwnershipModal {...defaultProps} />);

      // Search and select user
      const input = screen.getByPlaceholderText('Search users by username...');
      await user.type(input, 'alice');

      await waitFor(() => {
        expect(screen.getByText('alice')).toBeInTheDocument();
      });

      await user.click(screen.getByText('alice'));

      // Submit
      const submitButton = screen.getByText('Initiate Transfer');
      await user.click(submitButton);

      await waitFor(() => {
        expect(defaultProps.onTransferInitiated).toHaveBeenCalled();
      });
    });

    it('shows error message on failure', async () => {
      vi.mocked(transfersApi.initiateTransfer).mockRejectedValue({
        message: 'Cannot transfer to yourself',
      });

      const user = userEvent.setup();
      render(<TransferOwnershipModal {...defaultProps} />);

      // Search and select user
      const input = screen.getByPlaceholderText('Search users by username...');
      await user.type(input, 'alice');

      await waitFor(() => {
        expect(screen.getByText('alice')).toBeInTheDocument();
      });

      await user.click(screen.getByText('alice'));

      // Submit
      const submitButton = screen.getByText('Initiate Transfer');
      await user.click(submitButton);

      await waitFor(() => {
        expect(screen.getByText(/Failed to initiate transfer/)).toBeInTheDocument();
      });
    });

    it('shows ApiError message when transfer API rejects with ApiError', async () => {
      vi.mocked(transfersApi.initiateTransfer).mockRejectedValue(
        new ApiError('Transfer blocked by policy', 400)
      );

      const user = userEvent.setup();
      render(<TransferOwnershipModal {...defaultProps} />);

      const input = screen.getByPlaceholderText('Search users by username...');
      await user.type(input, 'alice');

      await waitFor(() => {
        expect(screen.getByText('alice')).toBeInTheDocument();
      });

      await user.click(screen.getByText('alice'));
      await user.click(screen.getByText('Initiate Transfer'));

      await waitFor(() => {
        expect(screen.getByText('Transfer blocked by policy')).toBeInTheDocument();
      });
    });

    it('shows loading state during submission', async () => {
      vi.mocked(transfersApi.initiateTransfer).mockImplementation(
        () => new Promise<never>(() => undefined)
      );

      const user = userEvent.setup();
      render(<TransferOwnershipModal {...defaultProps} />);

      // Search and select user
      const input = screen.getByPlaceholderText('Search users by username...');
      await user.type(input, 'alice');

      await waitFor(() => {
        expect(screen.getByText('alice')).toBeInTheDocument();
      });

      await user.click(screen.getByText('alice'));

      // Submit
      const submitButton = screen.getByText('Initiate Transfer');
      await user.click(submitButton);

      // Button should show loading state
      expect(submitButton.closest('button')).toBeDisabled();
    });
  });

  describe('cancel action', () => {
    it('shows cancel button', () => {
      render(<TransferOwnershipModal {...defaultProps} />);

      expect(screen.getByText('Cancel')).toBeInTheDocument();
    });

    it('calls onClose when cancel clicked', async () => {
      const user = userEvent.setup();
      render(<TransferOwnershipModal {...defaultProps} />);

      await user.click(screen.getByText('Cancel'));

      expect(defaultProps.onClose).toHaveBeenCalled();
    });

    it('calls onClose when X clicked', async () => {
      const user = userEvent.setup();
      render(<TransferOwnershipModal {...defaultProps} />);

      // Find the close X button in header
      const closeButton = document.querySelector('button[class*="text-sanctuary-400"]');
      if (closeButton) {
        await user.click(closeButton);
        expect(defaultProps.onClose).toHaveBeenCalled();
      }
    });
  });
});
