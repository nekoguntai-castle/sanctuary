import React from 'react';
import { ErrorAlert } from '../ui/ErrorAlert';
import type { TransferOwnershipModalState } from './types';
import { RecipientSelector } from './RecipientSelector';
import { TransferOptionsFields } from './TransferOptionsFields';
import { TransferOwnershipActions } from './TransferOwnershipActions';
import { TransferOwnershipWarning } from './TransferOwnershipWarning';

interface TransferOwnershipFormProps {
  modal: TransferOwnershipModalState;
  onClose: () => void;
}

export const TransferOwnershipForm: React.FC<TransferOwnershipFormProps> = ({
  modal,
  onClose,
}) => (
  <form onSubmit={modal.handleSubmit} className="p-6 space-y-6">
    <TransferOwnershipWarning />
    <ErrorAlert message={modal.error} className="mb-0" />
    <RecipientSelector
      selectedUser={modal.selectedUser}
      searchQuery={modal.searchQuery}
      searchResults={modal.searchResults}
      searching={modal.searching}
      onSearch={modal.handleSearch}
      onSelectUser={modal.handleSelectUser}
      onClearSelection={modal.handleClearSelection}
    />
    <TransferOptionsFields
      message={modal.message}
      keepExistingUsers={modal.keepExistingUsers}
      onMessageChange={modal.setMessage}
      onKeepExistingUsersChange={modal.setKeepExistingUsers}
    />
    <TransferOwnershipActions
      hasSelectedUser={Boolean(modal.selectedUser)}
      submitting={modal.submitting}
      onClose={onClose}
    />
  </form>
);
