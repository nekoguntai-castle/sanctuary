import type { FormEvent } from 'react';
import type { SearchUser } from '../../src/api/auth';

export interface TransferOwnershipModalProps {
  resourceType: 'wallet' | 'device';
  resourceId: string;
  resourceName: string;
  onClose: () => void;
  onTransferInitiated: () => void;
}

export interface TransferOwnershipModalState {
  searchQuery: string;
  searchResults: SearchUser[];
  searching: boolean;
  selectedUser: SearchUser | null;
  message: string;
  keepExistingUsers: boolean;
  submitting: boolean;
  error: string | null;
  resourceLabel: string;
  handleSearch: (query: string) => void;
  handleSelectUser: (user: SearchUser) => void;
  handleClearSelection: () => void;
  setMessage: (message: string) => void;
  setKeepExistingUsers: (keepExistingUsers: boolean) => void;
  handleSubmit: (event: FormEvent) => void;
}
