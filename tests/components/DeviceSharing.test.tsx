/**
 * Tests for components/DeviceSharing.tsx
 *
 * Tests the device sharing UI including user search, group selection,
 * and share/unshare actions.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { DeviceSharing } from '../../components/DeviceSharing';
import * as devicesApi from '../../src/api/devices';
import * as authApi from '../../src/api/auth';
import * as adminApi from '../../src/api/admin';
import { useUser } from '../../contexts/UserContext';

// Mock the APIs
vi.mock('../../src/api/devices', () => ({
  getDeviceShareInfo: vi.fn(),
  shareDeviceWithUser: vi.fn(),
  removeUserFromDevice: vi.fn(),
  shareDeviceWithGroup: vi.fn(),
}));

vi.mock('../../src/api/auth', () => ({
  getUserGroups: vi.fn(),
  searchUsers: vi.fn(),
}));

vi.mock('../../src/api/admin', () => ({
  getGroups: vi.fn(),
}));

// Mock UserContext
vi.mock('../../contexts/UserContext', () => ({
  useUser: vi.fn(() => ({
    user: {
      id: 'user-1',
      username: 'testuser',
      isAdmin: false,
    },
  })),
}));

describe('DeviceSharing', () => {
  const defaultProps = {
    deviceId: 'device-123',
    isOwner: true,
    userRole: 'owner' as const,
    onShareInfoChange: vi.fn(),
  };

  const mockShareInfo = {
    users: [
      { id: 'user-1', username: 'testuser', role: 'owner' as const },
      { id: 'user-2', username: 'viewer1', role: 'viewer' as const },
    ],
    group: null,
  };

  const mockGroups = [
    { id: 'group-1', name: 'Team A' },
    { id: 'group-2', name: 'Team B' },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useUser).mockReturnValue({
      user: {
        id: 'user-1',
        username: 'testuser',
        isAdmin: false,
      },
    } as any);
    vi.mocked(devicesApi.getDeviceShareInfo).mockResolvedValue(mockShareInfo);
    vi.mocked(authApi.getUserGroups).mockResolvedValue(mockGroups);
    vi.mocked(authApi.searchUsers).mockResolvedValue([]);
  });

  describe('loading state', () => {
    it('shows loading skeleton while fetching data', () => {
      vi.mocked(devicesApi.getDeviceShareInfo).mockImplementation(
        () => new Promise(() => {}) // Never resolves
      );
      vi.mocked(authApi.getUserGroups).mockImplementation(() => new Promise(() => {}));
      vi.mocked(authApi.searchUsers).mockImplementation(() => new Promise(() => {}));

      render(<DeviceSharing {...defaultProps} />);

      expect(document.querySelector('.animate-pulse')).toBeInTheDocument();
    });
  });

  describe('rendering', () => {
    it('renders Your Access section', async () => {
      render(<DeviceSharing {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('Your Access')).toBeInTheDocument();
      });
    });

    it('renders Ownership section', async () => {
      render(<DeviceSharing {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('Ownership')).toBeInTheDocument();
      });
    });

    it('renders Group Access section', async () => {
      render(<DeviceSharing {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('Group Access')).toBeInTheDocument();
      });
    });

    it('renders Individual Access section', async () => {
      render(<DeviceSharing {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('Individual Access')).toBeInTheDocument();
      });
    });

    it('shows user role badge', async () => {
      render(<DeviceSharing {...defaultProps} userRole="owner" />);

      await waitFor(() => {
        expect(screen.getByText('Full Control')).toBeInTheDocument();
      });
    });

    it('shows Read Only badge for non-owners', async () => {
      render(<DeviceSharing {...defaultProps} userRole="viewer" isOwner={false} />);

      await waitFor(() => {
        expect(screen.getByText('Read Only')).toBeInTheDocument();
      });
    });
  });

  describe('fetching data', () => {
    it('fetches share info on mount', async () => {
      render(<DeviceSharing {...defaultProps} />);

      await waitFor(() => {
        expect(devicesApi.getDeviceShareInfo).toHaveBeenCalledWith('device-123');
      });
    });

    it('fetches user groups on mount', async () => {
      render(<DeviceSharing {...defaultProps} />);

      await waitFor(() => {
        expect(authApi.getUserGroups).toHaveBeenCalled();
      });
    });

    it('fetches admin groups for admin users', async () => {
      vi.mocked(useUser).mockReturnValue({
        user: {
          id: 'admin-1',
          username: 'admin',
          isAdmin: true,
        },
      } as any);
      vi.mocked(adminApi.getGroups).mockResolvedValue(mockGroups as any);

      render(<DeviceSharing {...defaultProps} />);

      await waitFor(() => {
        expect(adminApi.getGroups).toHaveBeenCalled();
      });
      expect(authApi.getUserGroups).not.toHaveBeenCalled();
    });

    it('calls onShareInfoChange when share info is fetched', async () => {
      const onShareInfoChange = vi.fn();
      render(<DeviceSharing {...defaultProps} onShareInfoChange={onShareInfoChange} />);

      await waitFor(() => {
        expect(onShareInfoChange).toHaveBeenCalledWith(mockShareInfo);
      });
    });
  });

  describe('group sharing', () => {
    it('shows "Share with Group" section for owners', async () => {
      render(<DeviceSharing {...defaultProps} isOwner={true} />);

      await waitFor(() => {
        expect(screen.getByText('Share with Group')).toBeInTheDocument();
      });
    });

    it('does not show "Share with Group" for non-owners', async () => {
      render(<DeviceSharing {...defaultProps} isOwner={false} />);

      await waitFor(() => {
        expect(screen.queryByText('Share with Group')).not.toBeInTheDocument();
      });
    });

    it('renders group dropdown with available groups', async () => {
      render(<DeviceSharing {...defaultProps} />);

      await waitFor(() => {
        // Find the select element for groups
        const select = document.querySelector('select');
        expect(select).toBeInTheDocument();
      });

      expect(screen.getByText('Team A')).toBeInTheDocument();
      expect(screen.getByText('Team B')).toBeInTheDocument();
    });

    it('shows empty state when not shared with a group', async () => {
      render(<DeviceSharing {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('Not shared with any group.')).toBeInTheDocument();
      });
    });

    it('shows current group when shared', async () => {
      vi.mocked(devicesApi.getDeviceShareInfo).mockResolvedValue({
        ...mockShareInfo,
        group: { id: 'group-1', name: 'Team A' },
      });

      render(<DeviceSharing {...defaultProps} />);

      // Wait for loading to complete first
      await waitFor(() => {
        expect(document.querySelector('.animate-pulse')).not.toBeInTheDocument();
      });

      expect(screen.getByText(/All members of this group have/)).toBeInTheDocument();
    });

    it('calls shareDeviceWithGroup when adding group', async () => {
      vi.mocked(devicesApi.shareDeviceWithGroup).mockResolvedValue({} as any);

      render(<DeviceSharing {...defaultProps} />);

      await waitFor(() => {
        expect(document.querySelector('select')).toBeInTheDocument();
      });

      // Select a group
      const select = document.querySelector('select') as HTMLSelectElement;
      fireEvent.change(select, { target: { value: 'group-1' } });

      // Click Add button (first one in the group section)
      const addButtons = screen.getAllByText('Add as Viewer');
      fireEvent.click(addButtons[0]);

      await waitFor(() => {
        expect(devicesApi.shareDeviceWithGroup).toHaveBeenCalledWith('device-123', { groupId: 'group-1' });
      });
    });

    it('returns early when trying to add group without selecting one', async () => {
      vi.mocked(devicesApi.shareDeviceWithGroup).mockResolvedValue({} as any);
      render(<DeviceSharing {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('Share with Group')).toBeInTheDocument();
      });

      const addButton = screen.getAllByText('Add as Viewer')[0] as HTMLButtonElement;
      expect(addButton).toBeDisabled();
      fireEvent.click(addButton);

      expect(devicesApi.shareDeviceWithGroup).not.toHaveBeenCalled();
    });

    it('shows no-groups helper when user has no groups', async () => {
      vi.mocked(authApi.getUserGroups).mockResolvedValue([]);
      render(<DeviceSharing {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('You are not a member of any groups yet.')).toBeInTheDocument();
      });
    });

    it('removes group access when clicking group Remove', async () => {
      vi.mocked(devicesApi.getDeviceShareInfo).mockResolvedValue({
        users: [{ id: 'user-1', username: 'testuser', role: 'owner' as const }],
        group: { id: 'group-1', name: 'Team A' },
      });
      vi.mocked(devicesApi.shareDeviceWithGroup).mockResolvedValue({} as any);

      render(<DeviceSharing {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('Team A')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText('Remove'));

      await waitFor(() => {
        expect(devicesApi.shareDeviceWithGroup).toHaveBeenCalledWith('device-123', { groupId: null });
      });
    });
  });

  describe('user sharing', () => {
    it('shows user search input for owners', async () => {
      render(<DeviceSharing {...defaultProps} isOwner={true} />);

      await waitFor(() => {
        expect(screen.getByPlaceholderText('Search users by username...')).toBeInTheDocument();
      });
    });

    it('does not show user search for non-owners', async () => {
      render(<DeviceSharing {...defaultProps} isOwner={false} />);

      await waitFor(() => {
        expect(screen.queryByPlaceholderText('Search users by username...')).not.toBeInTheDocument();
      });
    });

    it('searches users when typing', async () => {
      vi.mocked(authApi.searchUsers).mockResolvedValue([
        { id: 'user-3', username: 'newuser' },
      ]);

      render(<DeviceSharing {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByPlaceholderText('Search users by username...')).toBeInTheDocument();
      });

      const searchInput = screen.getByPlaceholderText('Search users by username...');
      fireEvent.change(searchInput, { target: { value: 'new' } });

      await waitFor(() => {
        expect(authApi.searchUsers).toHaveBeenCalledWith('new');
      });
    });

    it('does not search with less than 2 characters', async () => {
      render(<DeviceSharing {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByPlaceholderText('Search users by username...')).toBeInTheDocument();
      });

      const searchInput = screen.getByPlaceholderText('Search users by username...');
      fireEvent.change(searchInput, { target: { value: 'a' } });

      expect(authApi.searchUsers).not.toHaveBeenCalled();
    });

    it('shows search results dropdown', async () => {
      vi.mocked(authApi.searchUsers).mockResolvedValue([
        { id: 'user-3', username: 'newuser' },
      ]);

      render(<DeviceSharing {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByPlaceholderText('Search users by username...')).toBeInTheDocument();
      });

      const searchInput = screen.getByPlaceholderText('Search users by username...');
      fireEvent.change(searchInput, { target: { value: 'new' } });

      await waitFor(() => {
        expect(screen.getByText('newuser')).toBeInTheDocument();
      });
    });

    it('shares device with user when clicking Add', async () => {
      vi.mocked(authApi.searchUsers).mockResolvedValue([
        { id: 'user-3', username: 'newuser' },
      ]);
      vi.mocked(devicesApi.shareDeviceWithUser).mockResolvedValue({} as any);

      render(<DeviceSharing {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByPlaceholderText('Search users by username...')).toBeInTheDocument();
      });

      const searchInput = screen.getByPlaceholderText('Search users by username...');
      fireEvent.change(searchInput, { target: { value: 'new' } });

      await waitFor(() => {
        expect(screen.getByText('newuser')).toBeInTheDocument();
      });

      // Click Add as Viewer button in the dropdown
      const addButtons = screen.getAllByText('Add as Viewer');
      fireEvent.click(addButtons[addButtons.length - 1]);

      await waitFor(() => {
        expect(devicesApi.shareDeviceWithUser).toHaveBeenCalledWith('device-123', { targetUserId: 'user-3' });
      });
    });

    it('keeps search state when share-with-user fails', async () => {
      vi.mocked(authApi.searchUsers).mockResolvedValue([
        { id: 'user-3', username: 'newuser' },
      ]);
      vi.mocked(devicesApi.shareDeviceWithUser).mockRejectedValue({ message: 'User share failed' });

      render(<DeviceSharing {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByPlaceholderText('Search users by username...')).toBeInTheDocument();
      });

      const searchInput = screen.getByPlaceholderText('Search users by username...') as HTMLInputElement;
      fireEvent.change(searchInput, { target: { value: 'new' } });

      await waitFor(() => {
        expect(screen.getByText('newuser')).toBeInTheDocument();
      });

      const addButtons = screen.getAllByText('Add as Viewer');
      fireEvent.click(addButtons[addButtons.length - 1]);

      await waitFor(() => {
        expect(screen.getByText('User share failed')).toBeInTheDocument();
      });
      expect(searchInput.value).toBe('new');
      expect(screen.getByText('newuser')).toBeInTheDocument();
    });

    it('logs and recovers when user search fails', async () => {
      vi.mocked(authApi.searchUsers).mockRejectedValue(new Error('search failed'));

      render(<DeviceSharing {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByPlaceholderText('Search users by username...')).toBeInTheDocument();
      });

      const searchInput = screen.getByPlaceholderText('Search users by username...');
      fireEvent.change(searchInput, { target: { value: 'new' } });

      await waitFor(() => {
        expect(authApi.searchUsers).toHaveBeenCalledWith('new');
      });
      await waitFor(() => {
        expect(document.querySelector('.animate-spin')).not.toBeInTheDocument();
      });
    });

    it('shows current users with viewer access', async () => {
      render(<DeviceSharing {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('viewer1')).toBeInTheDocument();
      });
    });

    it('shows empty state when no individual users', async () => {
      vi.mocked(devicesApi.getDeviceShareInfo).mockResolvedValue({
        users: [{ id: 'user-1', username: 'testuser', role: 'owner' as const }],
        group: null,
      });

      render(<DeviceSharing {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('Not shared with any individual users.')).toBeInTheDocument();
      });
    });
  });

  describe('removing access', () => {
    it('shows remove button for users (owner only)', async () => {
      render(<DeviceSharing {...defaultProps} isOwner={true} />);

      await waitFor(() => {
        const removeButtons = screen.getAllByText('Remove');
        expect(removeButtons.length).toBeGreaterThan(0);
      });
    });

    it('does not show remove button for non-owners', async () => {
      render(<DeviceSharing {...defaultProps} isOwner={false} />);

      await waitFor(() => {
        expect(screen.queryByText('Remove')).not.toBeInTheDocument();
      });
    });

    it('calls removeUserFromDevice when clicking Remove', async () => {
      vi.mocked(devicesApi.removeUserFromDevice).mockResolvedValue({} as any);

      render(<DeviceSharing {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('viewer1')).toBeInTheDocument();
      });

      const removeButtons = screen.getAllByText('Remove');
      fireEvent.click(removeButtons[removeButtons.length - 1]);

      await waitFor(() => {
        expect(devicesApi.removeUserFromDevice).toHaveBeenCalledWith('device-123', 'user-2');
      });
    });
  });

  describe('error handling', () => {
    it('shows error message when fetching fails', async () => {
      vi.mocked(devicesApi.getDeviceShareInfo).mockRejectedValue(new Error('API Error'));

      render(<DeviceSharing {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('API Error')).toBeInTheDocument();
      });
    });

    it('shows error when sharing fails', async () => {
      vi.mocked(devicesApi.shareDeviceWithGroup).mockRejectedValue({ message: 'Share failed' });

      render(<DeviceSharing {...defaultProps} />);

      await waitFor(() => {
        expect(document.querySelector('select')).toBeInTheDocument();
      });

      // Select a group
      const select = document.querySelector('select') as HTMLSelectElement;
      fireEvent.change(select, { target: { value: 'group-1' } });

      // Click Add button (first one)
      const addButtons = screen.getAllByText('Add as Viewer');
      fireEvent.click(addButtons[0]);

      await waitFor(() => {
        expect(screen.getByText('Share failed')).toBeInTheDocument();
      });
    });
  });

  describe('filtering', () => {
    it('filters out users who already have access from search results', async () => {
      vi.mocked(authApi.searchUsers).mockResolvedValue([
        { id: 'user-1', username: 'testuser' }, // Already owner
        { id: 'user-2', username: 'viewer1' },  // Already viewer
        { id: 'user-3', username: 'newuser' },  // Not shared
      ]);

      render(<DeviceSharing {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByPlaceholderText('Search users by username...')).toBeInTheDocument();
      });

      const searchInput = screen.getByPlaceholderText('Search users by username...');
      fireEvent.change(searchInput, { target: { value: 'user' } });

      await waitFor(() => {
        // Only newuser should be shown
        expect(screen.getByText('newuser')).toBeInTheDocument();
        // testuser and viewer1 should not be in dropdown
        const dropdown = document.querySelector('.absolute.z-10');
        if (dropdown) {
          expect(dropdown.textContent).not.toContain('testuser');
        }
      });
    });

    it('does not filter users when share info is null', async () => {
      vi.mocked(devicesApi.getDeviceShareInfo).mockResolvedValue(null as any);
      vi.mocked(authApi.searchUsers).mockResolvedValue([
        { id: 'user-1', username: 'testuser' },
      ]);

      render(<DeviceSharing {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByPlaceholderText('Search users by username...')).toBeInTheDocument();
      });

      const searchInput = screen.getByPlaceholderText('Search users by username...');
      fireEvent.change(searchInput, { target: { value: 'test' } });

      await waitFor(() => {
        const dropdown = document.querySelector('.absolute.z-10');
        expect(dropdown).toBeInTheDocument();
        expect(dropdown?.textContent).toContain('testuser');
      });
    });
  });

  describe('fallback rendering', () => {
    it('uses user fallback labels when username and role are missing', async () => {
      vi.mocked(useUser).mockReturnValue({
        user: {
          id: 'user-empty',
          username: '',
          isAdmin: false,
        },
      } as any);

      render(<DeviceSharing {...defaultProps} userRole={'' as any} />);

      await waitFor(() => {
        expect(screen.getByText('Your Access')).toBeInTheDocument();
      });

      expect(screen.getByText('You')).toBeInTheDocument();
      expect(screen.getByText('Unknown Access')).toBeInTheDocument();
      expect(screen.getByText('U')).toBeInTheDocument();
    });

    it('falls back ownership display to current user when owner entry is missing', async () => {
      vi.mocked(devicesApi.getDeviceShareInfo).mockResolvedValue({
        users: [{ id: 'user-2', username: 'viewer1', role: 'viewer' as const }],
        group: null,
      });

      render(<DeviceSharing {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('Ownership')).toBeInTheDocument();
      });

      const ownerRole = screen.getByText('Device Owner');
      expect(ownerRole.previousElementSibling).toHaveTextContent('testuser');
    });

    it('falls back ownership username and avatar initial when owner username is empty', async () => {
      vi.mocked(devicesApi.getDeviceShareInfo).mockResolvedValue({
        users: [{ id: 'user-1', username: '', role: 'owner' as const }],
        group: null,
      });

      render(<DeviceSharing {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('Ownership')).toBeInTheDocument();
      });

      const ownerRole = screen.getByText('Device Owner');
      expect(ownerRole.previousElementSibling).toHaveTextContent('testuser');
      expect(screen.getAllByText('T').length).toBeGreaterThan(0);
    });

    it('uses final ownership fallbacks when both owner and current usernames are empty', async () => {
      vi.mocked(useUser).mockReturnValue({
        user: {
          id: 'user-empty',
          username: '',
          isAdmin: false,
        },
      } as any);
      vi.mocked(devicesApi.getDeviceShareInfo).mockResolvedValue({
        users: [{ id: 'owner-empty', username: '', role: 'owner' as const }],
        group: null,
      });

      render(<DeviceSharing {...defaultProps} userRole={'' as any} />);

      await waitFor(() => {
        expect(screen.getByText('Ownership')).toBeInTheDocument();
      });

      const ownerRole = screen.getByText('Device Owner');
      expect(ownerRole.previousElementSibling).toHaveTextContent('You');
      expect(screen.getAllByText('U').length).toBeGreaterThan(0);
    });
  });
});
