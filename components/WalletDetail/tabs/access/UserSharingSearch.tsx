import React from 'react';
import type { SearchUser } from '../../../../src/api/auth';
import type { WalletAccessRole } from './accessTabData';

interface UserSharingSearchProps {
  query: string;
  onSearchUsers: (query: string) => void;
  searchingUsers: boolean;
  userSearchResults: SearchUser[];
  sharingLoading: boolean;
  onShareWithUser: (userId: string, role: WalletAccessRole) => void;
}

export const UserSharingSearch: React.FC<UserSharingSearchProps> = ({
  query,
  onSearchUsers,
  searchingUsers,
  userSearchResults,
  sharingLoading,
  onShareWithUser,
}) => (
  <div className="flex-1 min-w-[200px] relative">
    <input
      type="text"
      value={query}
      onChange={(event) => onSearchUsers(event.target.value)}
      placeholder="Add user..."
      className="w-full text-sm surface-elevated border border-sanctuary-200 dark:border-sanctuary-700 rounded-md px-2 py-1.5"
    />
    {searchingUsers && (
      <div className="absolute right-2 top-2">
        <div className="animate-spin rounded-full h-4 w-4 border border-primary-500 border-t-transparent" />
      </div>
    )}
    {userSearchResults.length > 0 && (
      <div className="absolute z-10 w-full mt-1 surface-elevated border border-sanctuary-200 dark:border-sanctuary-700 rounded-lg shadow-lg max-h-40 overflow-y-auto">
        {userSearchResults.map((searchUser) => (
          <div
            key={searchUser.id}
            className="px-2 py-1.5 hover:bg-sanctuary-50 dark:hover:bg-sanctuary-800 flex items-center justify-between"
          >
            <div className="flex items-center">
              <div className="h-5 w-5 rounded-full bg-sanctuary-200 dark:bg-sanctuary-700 flex items-center justify-center text-xs font-bold text-sanctuary-600 dark:text-sanctuary-300 mr-2">
                {searchUser.username.charAt(0).toUpperCase()}
              </div>
              <span className="text-sm">{searchUser.username}</span>
            </div>
            <div className="flex gap-1">
              <button
                onClick={() => onShareWithUser(searchUser.id, 'viewer')}
                disabled={sharingLoading}
                className="text-xs px-1.5 py-0.5 rounded bg-sanctuary-200 dark:bg-sanctuary-700 hover:bg-sanctuary-300 dark:hover:bg-sanctuary-600 disabled:opacity-50"
              >
                View
              </button>
              <button
                onClick={() => onShareWithUser(searchUser.id, 'signer')}
                disabled={sharingLoading}
                className="text-xs px-1.5 py-0.5 rounded bg-warning-100 dark:bg-warning-900/30 text-warning-700 dark:text-warning-300 hover:bg-warning-200 dark:hover:bg-warning-900/50 disabled:opacity-50"
              >
                Sign
              </button>
            </div>
          </div>
        ))}
      </div>
    )}
  </div>
);
