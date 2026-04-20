import { useCallback,useState } from 'react';
import type { FormEvent } from 'react';
import * as authApi from '../../src/api/auth';
import { ApiError } from '../../src/api/client';
import * as transfersApi from '../../src/api/transfers';
import { createLogger } from '../../utils/logger';
import type { TransferOwnershipModalProps, TransferOwnershipModalState } from './types';

const log = createLogger('TransferOwnershipModal');

export function useTransferOwnershipModal({
  resourceType,
  resourceId,
  onTransferInitiated,
}: Pick<TransferOwnershipModalProps, 'resourceType' | 'resourceId' | 'onTransferInitiated'>): TransferOwnershipModalState {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<authApi.SearchUser[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedUser, setSelectedUser] = useState<authApi.SearchUser | null>(null);
  const [message, setMessage] = useState('');
  const [keepExistingUsers, setKeepExistingUsers] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  const handleSelectUser = useCallback((user: authApi.SearchUser) => {
    setSelectedUser(user);
    setSearchQuery('');
    setSearchResults([]);
    setError(null);
  }, []);

  const handleClearSelection = useCallback(() => {
    setSelectedUser(null);
    setError(null);
  }, []);

  const handleSubmit = useCallback(async (event: FormEvent) => {
    event.preventDefault();

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
      setError(err instanceof ApiError ? err.message : 'Failed to initiate transfer');
    } finally {
      setSubmitting(false);
    }
  }, [keepExistingUsers, message, onTransferInitiated, resourceId, resourceType, selectedUser]);

  return {
    searchQuery,
    searchResults,
    searching,
    selectedUser,
    message,
    keepExistingUsers,
    submitting,
    error,
    resourceLabel: resourceType === 'wallet' ? 'Wallet' : 'Device',
    handleSearch,
    handleSelectUser,
    handleClearSelection,
    setMessage,
    setKeepExistingUsers,
    handleSubmit,
  };
}
