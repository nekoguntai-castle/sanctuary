/**
 * TransferOwnershipModal Component
 *
 * Modal for initiating an ownership transfer of a wallet or device.
 * Allows owner to search for a recipient and optionally include a message.
 */

import React, { useState, useCallback } from 'react';
import { X, UserPlus, AlertTriangle, Search, Send } from 'lucide-react';
import { Button } from './ui/Button';
import * as authApi from '../src/api/auth';
import * as transfersApi from '../src/api/transfers';
import { ApiError } from '../src/api/client';
import { createLogger } from '../utils/logger';

const log = createLogger('TransferOwnershipModal');

interface TransferOwnershipModalProps {
  resourceType: 'wallet' | 'device';
  resourceId: string;
  resourceName: string;
  onClose: () => void;
  onTransferInitiated: () => void;
}

export const TransferOwnershipModal: React.FC<TransferOwnershipModalProps> = ({
  resourceType,
  resourceId,
  resourceName,
  onClose,
  onTransferInitiated,
}) => {
  // User search state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<authApi.SearchUser[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedUser, setSelectedUser] = useState<authApi.SearchUser | null>(null);

  // Transfer options
  const [message, setMessage] = useState('');
  const [keepExistingUsers, setKeepExistingUsers] = useState(true);

  // Submission state
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Search for users
  const handleSearch = useCallback(async (query: string) => {
    setSearchQuery(query);

    if (query.length < 2) {
      setSearchResults([]);
      return;
    }

    setSearching(true);
    try {
      const results = await authApi.searchUsers(query);
      setSearchResults(results);
    } catch (err) {
      log.error('Failed to search users', { err });
    } finally {
      setSearching(false);
    }
  }, []);

  // Select a user from search results
  const handleSelectUser = (user: authApi.SearchUser) => {
    setSelectedUser(user);
    setSearchQuery('');
    setSearchResults([]);
    setError(null);
  };

  // Clear selected user
  const handleClearSelection = () => {
    setSelectedUser(null);
    setError(null);
  };

  // Submit transfer request
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!selectedUser) {
      setError('Please select a recipient');
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      await transfersApi.initiateTransfer({
        resourceType,
        resourceId,
        toUserId: selectedUser.id,
        message: message.trim() || undefined,
        keepExistingUsers,
      });

      log.info('Transfer initiated', {
        resourceType,
        resourceId,
        toUserId: selectedUser.id,
      });

      onTransferInitiated();
    } catch (err) {
      log.error('Failed to initiate transfer', { err });
      const errMessage = err instanceof ApiError ? err.message : 'Failed to initiate transfer';
      setError(errMessage);
    } finally {
      setSubmitting(false);
    }
  };

  const resourceLabel = resourceType === 'wallet' ? 'Wallet' : 'Device';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="surface-elevated rounded-2xl border border-sanctuary-200 dark:border-sanctuary-800 max-w-lg w-full shadow-2xl animate-modal-enter">
        {/* Header */}
        <div className="p-6 border-b border-sanctuary-100 dark:border-sanctuary-800">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="p-2 bg-amber-100 dark:bg-amber-900/30 rounded-lg text-amber-600 dark:text-amber-400">
                <UserPlus className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-lg font-medium text-sanctuary-900 dark:text-sanctuary-100">
                  Transfer Ownership
                </h3>
                <p className="text-xs text-sanctuary-500 dark:text-sanctuary-400 mt-0.5">
                  {resourceLabel}: {resourceName}
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="text-sanctuary-400 hover:text-sanctuary-600 dark:hover:text-sanctuary-300 p-1 rounded-lg hover:bg-sanctuary-100 dark:hover:bg-sanctuary-800 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Content */}
        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {/* Warning */}
          <div className="p-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl flex items-start">
            <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400 mr-3 flex-shrink-0 mt-0.5" />
            <div className="text-sm text-amber-800 dark:text-amber-300">
              <p className="font-medium mb-1">3-Step Transfer Process</p>
              <ol className="list-decimal list-inside space-y-0.5 text-xs">
                <li>You initiate the transfer (this step)</li>
                <li>Recipient accepts or declines</li>
                <li>You confirm to complete the transfer</li>
              </ol>
              <p className="mt-2 text-xs">You can cancel at any time before the final confirmation.</p>
            </div>
          </div>

          {/* Error Display */}
          {error && (
            <div className="p-4 bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 rounded-xl text-rose-700 dark:text-rose-300 text-sm animate-fade-in">
              {error}
            </div>
          )}

          {/* Recipient Selection */}
          <div>
            <label className="block text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300 mb-2">
              New Owner
            </label>

            {selectedUser ? (
              <div className="flex items-center justify-between p-3 surface-secondary rounded-xl border border-sanctuary-200 dark:border-sanctuary-700">
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
                  onClick={handleClearSelection}
                  className="text-sanctuary-400 hover:text-sanctuary-600 dark:hover:text-sanctuary-300 p-1"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <div className="relative">
                <div className="absolute left-3 top-1/2 -translate-y-1/2 text-sanctuary-400">
                  <Search className="w-4 h-4" />
                </div>
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => handleSearch(e.target.value)}
                  placeholder="Search users by username..."
                  className="w-full pl-10 pr-10 py-3 surface-muted border border-sanctuary-200 dark:border-sanctuary-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500 text-sanctuary-900 dark:text-sanctuary-100"
                />
                {searching && (
                  <div className="absolute right-3 top-1/2 -translate-y-1/2">
                    <div className="animate-spin rounded-full h-4 w-4 border-2 border-primary-500 border-t-transparent" />
                  </div>
                )}

                {/* Search Results */}
                {searchResults.length > 0 && (
                  <div className="absolute z-10 w-full mt-1 surface-elevated border border-sanctuary-200 dark:border-sanctuary-700 rounded-xl shadow-lg max-h-48 overflow-y-auto">
                    {searchResults.map((user) => (
                      <button
                        key={user.id}
                        type="button"
                        onClick={() => handleSelectUser(user)}
                        className="w-full px-4 py-3 flex items-center hover:bg-sanctuary-50 dark:hover:bg-sanctuary-800 transition-colors text-left"
                      >
                        <div className="h-8 w-8 rounded-full bg-sanctuary-200 dark:bg-sanctuary-700 flex items-center justify-center text-sm font-bold text-sanctuary-600 dark:text-sanctuary-300 mr-3">
                          {user.username.charAt(0).toUpperCase()}
                        </div>
                        <span className="text-sm text-sanctuary-900 dark:text-sanctuary-100">{user.username}</span>
                      </button>
                    ))}
                  </div>
                )}

                {searchQuery.length >= 2 && searchResults.length === 0 && !searching && (
                  <div className="absolute z-10 w-full mt-1 surface-elevated border border-sanctuary-200 dark:border-sanctuary-700 rounded-xl shadow-lg p-4 text-center text-sm text-sanctuary-500">
                    No users found
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Message (optional) */}
          <div>
            <label className="block text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300 mb-2">
              Message (Optional)
            </label>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Add a note for the recipient..."
              rows={3}
              maxLength={500}
              className="w-full px-4 py-3 surface-muted border border-sanctuary-200 dark:border-sanctuary-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500 text-sanctuary-900 dark:text-sanctuary-100 resize-none"
            />
            <p className="text-xs text-sanctuary-400 mt-1">{message.length}/500 characters</p>
          </div>

          {/* Keep Existing Users Option */}
          <div className="flex items-start">
            <input
              type="checkbox"
              id="keepExistingUsers"
              checked={keepExistingUsers}
              onChange={(e) => setKeepExistingUsers(e.target.checked)}
              className="mt-1 h-4 w-4 rounded border-sanctuary-300 text-primary-600 focus:ring-primary-500"
            />
            <label htmlFor="keepExistingUsers" className="ml-3">
              <span className="block text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300">
                Keep existing viewers
              </span>
              <span className="block text-xs text-sanctuary-500 mt-0.5">
                {keepExistingUsers
                  ? `You will retain viewer access after the transfer, and other shared users will keep their access.`
                  : `All existing access (including yours) will be removed after the transfer.`}
              </span>
            </label>
          </div>

          {/* Actions */}
          <div className="flex justify-end space-x-3 pt-4 border-t border-sanctuary-100 dark:border-sanctuary-800">
            <Button
              type="button"
              variant="secondary"
              onClick={onClose}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={!selectedUser || submitting}
              isLoading={submitting}
            >
              <Send className="w-4 h-4 mr-2" />
              Initiate Transfer
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
};
