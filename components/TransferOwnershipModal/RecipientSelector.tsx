import React from 'react';
import { Search, X } from 'lucide-react';
import type { SearchUser } from '../../src/api/auth';

interface SelectedRecipientProps {
  selectedUser: SearchUser;
  onClearSelection: () => void;
}

const SelectedRecipient: React.FC<SelectedRecipientProps> = ({
  selectedUser,
  onClearSelection,
}) => (
  <div className="flex items-center justify-between p-3 surface-secondary rounded-lg border border-sanctuary-200 dark:border-sanctuary-700">
    <div className="flex items-center">
      <div className="h-10 w-10 rounded-full bg-primary-100 dark:bg-primary-900/30 flex items-center justify-center text-lg font-bold text-primary-600 dark:text-primary-400 mr-3">
        {selectedUser.username.charAt(0).toUpperCase()}
      </div>
      <div>
        <p className="font-medium text-sanctuary-900 dark:text-sanctuary-100">{selectedUser.username}</p>
        <p className="text-xs text-sanctuary-500">Will receive ownership</p>
      </div>
    </div>
    <button
      type="button"
      onClick={onClearSelection}
      className="text-sanctuary-400 hover:text-sanctuary-600 dark:hover:text-sanctuary-300 p-1"
    >
      <X className="w-4 h-4" />
    </button>
  </div>
);

interface SearchResultsProps {
  searchResults: SearchUser[];
  onSelectUser: (user: SearchUser) => void;
}

const SearchResults: React.FC<SearchResultsProps> = ({
  searchResults,
  onSelectUser,
}) => (
  <div className="absolute z-10 w-full mt-1 surface-elevated border border-sanctuary-200 dark:border-sanctuary-700 rounded-lg shadow-lg max-h-48 overflow-y-auto">
    {searchResults.map((user) => (
      <button
        key={user.id}
        type="button"
        onClick={() => onSelectUser(user)}
        className="w-full px-4 py-3 flex items-center hover:bg-sanctuary-50 dark:hover:bg-sanctuary-800 transition-colors text-left"
      >
        <div className="h-8 w-8 rounded-full bg-sanctuary-200 dark:bg-sanctuary-700 flex items-center justify-center text-sm font-bold text-sanctuary-600 dark:text-sanctuary-300 mr-3">
          {user.username.charAt(0).toUpperCase()}
        </div>
        <span className="text-sm text-sanctuary-900 dark:text-sanctuary-100">{user.username}</span>
      </button>
    ))}
  </div>
);

interface RecipientSearchProps {
  searchQuery: string;
  searchResults: SearchUser[];
  searching: boolean;
  onSearch: (query: string) => void;
  onSelectUser: (user: SearchUser) => void;
}

const RecipientSearch: React.FC<RecipientSearchProps> = ({
  searchQuery,
  searchResults,
  searching,
  onSearch,
  onSelectUser,
}) => (
  <div className="relative">
    <div className="absolute left-3 top-1/2 -translate-y-1/2 text-sanctuary-400">
      <Search className="w-4 h-4" />
    </div>
    <input
      type="text"
      value={searchQuery}
      onChange={(event) => onSearch(event.target.value)}
      placeholder="Search users by username..."
      className="w-full pl-10 pr-10 py-3 surface-muted border border-sanctuary-200 dark:border-sanctuary-700 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500 text-sanctuary-900 dark:text-sanctuary-100"
    />
    {searching && (
      <div className="absolute right-3 top-1/2 -translate-y-1/2">
        <div className="animate-spin rounded-full h-4 w-4 border border-primary-500 border-t-transparent" />
      </div>
    )}
    {searchResults.length > 0 && (
      <SearchResults
        searchResults={searchResults}
        onSelectUser={onSelectUser}
      />
    )}
    {searchQuery.length >= 2 && searchResults.length === 0 && !searching && (
      <div className="absolute z-10 w-full mt-1 surface-elevated border border-sanctuary-200 dark:border-sanctuary-700 rounded-lg shadow-lg p-4 text-center text-sm text-sanctuary-500">
        No users found
      </div>
    )}
  </div>
);

interface RecipientSelectorProps {
  selectedUser: SearchUser | null;
  searchQuery: string;
  searchResults: SearchUser[];
  searching: boolean;
  onSearch: (query: string) => void;
  onSelectUser: (user: SearchUser) => void;
  onClearSelection: () => void;
}

export const RecipientSelector: React.FC<RecipientSelectorProps> = ({
  selectedUser,
  searchQuery,
  searchResults,
  searching,
  onSearch,
  onSelectUser,
  onClearSelection,
}) => (
  <div>
    <label className="block text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300 mb-2">
      New Owner
    </label>
    {selectedUser ? (
      <SelectedRecipient
        selectedUser={selectedUser}
        onClearSelection={onClearSelection}
      />
    ) : (
      <RecipientSearch
        searchQuery={searchQuery}
        searchResults={searchResults}
        searching={searching}
        onSearch={onSearch}
        onSelectUser={onSelectUser}
      />
    )}
  </div>
);
